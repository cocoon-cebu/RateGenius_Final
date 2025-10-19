/**
 * RateGenius backend (production-ready starter)
 * - /api/scan: uses Google Places Nearby Search to find self-storage businesses
 * - For each place, attempts to scrape its website for price hints using Playwright
 * - /api/suggest: simple median-based suggestion with occupancy adjustment (placeholder)
 *
 * ENV:
 *  - PORT (default 5000)
 *  - GOOGLE_PLACES_API_KEY
 *  - ALLOWED_ORIGIN (frontend URL)
 *
 * Notes:
 * - This is a practical production starting point. Improve scraping selectors over time.
 * - Always respect robots.txt and site ToS. Use paid data if needed.
 */

const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const cors = require('cors');
const pRetry = require('p-retry');
const { chromium } = require('playwright');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 5000;
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use(cors({ origin: ALLOWED_ORIGIN }));

// Simple in-memory cache with TTL
const cache = new Map();
function setCache(key, value, ttlSec=3600){
  cache.set(key, { value, exp: Date.now() + ttlSec*1000 });
}
function getCache(key){
  const v = cache.get(key);
  if(!v) return null;
  if(Date.now() > v.exp){ cache.delete(key); return null; }
  return v.value;
}

// Helper median
function median(arr){
  if(!arr.length) return null;
  const s = arr.slice().sort((a,b)=>a-b);
  const m = Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}

// Google Places Nearby Search
async function placesNearby(addressOrLatLng, radiusMiles=10){
  // Accepts address or "lat,lng".
  let latlng = addressOrLatLng;
  // If address string given, call Geocoding
  if(!/^-?\d+\.\d+,-?\d+\.\d+$/.test(addressOrLatLng)){
    // Geocode
    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressOrLatLng)}&key=${GOOGLE_KEY}`;
    const geoRes = await fetch(geoUrl).then(r=>r.json());
    if(!geoRes.results || !geoRes.results.length) throw new Error('geocode failed');
    const loc = geoRes.results[0].geometry.location;
    latlng = `${loc.lat},${loc.lng}`;
  }
  const [lat, lng] = latlng.split(',').map(Number);
  const radiusMeters = Math.min(40000, Number(radiusMiles) * 1609.34); // cap to 40km
  const cacheKey = `places:${lat}:${lng}:${radiusMeters}`;
  const cached = getCache(cacheKey);
  if(cached) return cached;

  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${Math.round(radiusMeters)}&keyword=self%20storage&key=${GOOGLE_KEY}`;
  const res = await fetch(url).then(r=>r.json());
  if(!res.results) throw new Error('places API failed');
  const places = res.results.map(p=>({
    place_id: p.place_id,
    name: p.name,
    address: p.vicinity,
    location: p.geometry && p.geometry.location,
    types: p.types,
    // We'll resolve website with Place Details later
    rating: p.rating
  }));
  setCache(cacheKey, places, 6*3600);
  return places;
}

// Get place details (to retrieve website)
async function placeDetails(placeId){
  const cacheKey = `placedetail:${placeId}`;
  const cached = getCache(cacheKey);
  if(cached) return cached;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,website,formatted_phone_number,url,formatted_address&key=${GOOGLE_KEY}`;
  const res = await fetch(url).then(r=>r.json());
  if(!res.result) return null;
  setCache(cacheKey, res.result, 24*3600);
  return res.result;
}

// Simple domain politeness tracker (delay per host)
const hostLock = new Map();
async function politeWaitForHost(host){
  const last = hostLock.get(host) || 0;
  const now = Date.now();
  const gap = 2000; // 2 seconds between requests to same host
  if(now - last < gap){
    await new Promise(r=>setTimeout(r, gap - (now - last)));
  }
  hostLock.set(host, Date.now());
}

// Scrape a website for price hints
async function scrapeSiteForPrice(url){
  const cacheKey = `scrape:${url}`;
  const cached = getCache(cacheKey);
  if(cached) return cached;
  try{
    const u = new URL(url);
    await politeWaitForHost(u.host);
  }catch(e){ /* ignore */ }

  // Retry Playwright navigation a few times for transient errors
  const run = async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
    try{
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(30000);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      // simple heuristics: find visible text with $ amounts near unit-size strings like 10x10
      const content = await page.content();
      // regex for prices like $75 or $1,200
      const priceMatches = Array.from(content.matchAll(/\$\s?([0-9]{1,3}(?:,[0-9]{3})?(?:\.[0-9]{1,2})?)/g)).map(m=>m[1].replace(/,/g,'')).map(Number);
      // look for unit sizes
      const unitMatch = content.match(/(\d{1,2}\s?x\s?\d{1,2})/i);
      const unit = unitMatch ? unitMatch[1].replace(/\s+/g,'') : null;
      const price = priceMatches.length ? priceMatches[0] : null;
      const result = { price, unit, source: url };
      setCache(cacheKey, result, 12*3600);
      await browser.close();
      return result;
    }catch(err){
      try{ await browser.close(); }catch(e){}
      throw err;
    }
  };
  const res = await pRetry(run, { retries: 2, factor: 1.5 });
  return res;
}

// Endpoint: scan
app.post('/api/scan', async (req, res) => {
  try{
    const { facilityName, address, radius } = req.body;
    if(!address) return res.status(400).json({ error: 'address required' });
    const places = await placesNearby(address, radius || 10);
    // For each place, fetch details and attempt to scrape website for price
    const results = [];
    for(const p of places.slice(0, 20)){ // limit to 20 to avoid long runs
      try{
        const details = await placeDetails(p.place_id);
        const website = (details && details.website) || null;
        let scraped = null;
        if(website){
          try{
            scraped = await scrapeSiteForPrice(website);
          }catch(e){
            scraped = { error: 'scrape failed' };
          }
        }
        results.push({
          name: p.name,
          address: details && details.formatted_address || p.address,
          place_id: p.place_id,
          website: website,
          distance: null,
          unit: scraped && scraped.unit,
          price: scraped && scraped.price,
          source: website ? 'website' : 'places',
          availability: scraped && scraped.availability
        });
      }catch(e){
        results.push({ name: p.name, address: p.address, error: e.message });
      }
    }
    res.json({ competitors: results });
  }catch(err){
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: suggest
app.post('/api/suggest', async (req, res) => {
  try{
    const { facilityName, competitors } = req.body;
    const prices = (competitors||[]).map(c => Number(c.price)).filter(p=>!Number.isNaN(p));
    const med = median(prices);
    if(med === null) return res.status(400).json({ error: 'no competitor prices available' });
    const alpha = 0.06; // undercut factor
    const recommended = Math.round((med * (1 - alpha)) * 100) / 100;
    res.json({
      recommendedPrice: recommended,
      rationale: `Median competitor price is $${med}. Undercutting by ${alpha*100}%`,
      confidence: 0.6
    });
  }catch(err){
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req,res)=> res.json({status:'ok'}));
app.get('/', (req, res) => {
  res.send('✅ RateGenius backend is running successfully!');
});

app.listen(PORT, ()=> console.log(`RateGenius backend running on ${PORT}`));
