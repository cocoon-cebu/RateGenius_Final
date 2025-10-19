import React, {useState} from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function App(){
  const [facilityName, setFacilityName] = useState('');
  const [address, setAddress] = useState('');
  const [radius, setRadius] = useState(10);
  const [competitors, setCompetitors] = useState([]);
  const [suggestion, setSuggestion] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function findCompetitors(e){
    e && e.preventDefault();
    setError(null);
    setCompetitors([]);
    setSuggestion(null);
    if(!facilityName || !address){
      setError('Provide facility name and address/lat,lng');
      return;
    }
    setLoading(true);
    try{
      const res = await fetch(`${API_BASE}/scan`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({facilityName, address, radius})
      });
      if(!res.ok) throw new Error('scan failed');
      const data = await res.json();
      setCompetitors(data.competitors || []);
    }catch(err){
      setError(err.message);
    }finally{ setLoading(false); }
  }

  async function suggestPrice(){
    setLoading(true);
    setError(null);
    try{
      const res = await fetch(`${API_BASE}/suggest`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({facilityName, competitors})
      });
      if(!res.ok) throw new Error('suggest failed');
      const data = await res.json();
      setSuggestion(data);
    }catch(err){ setError(err.message); }
    finally{ setLoading(false); }
  }

  return (
    <div style={{maxWidth:900, margin:'2rem auto', fontFamily:'Inter, Arial'}}>
      <h1>RateGenius — Dynamic pricing for self-storage</h1>
      <form onSubmit={findCompetitors} style={{marginBottom:20}}>
        <div>
          <label>Facility name</label><br/>
          <input value={facilityName} onChange={e=>setFacilityName(e.target.value)} style={{width:'100%',padding:8}}/>
        </div>
        <div style={{marginTop:8}}>
          <label>Address or lat,lng</label><br/>
          <input value={address} onChange={e=>setAddress(e.target.value)} style={{width:'100%',padding:8}} placeholder="123 Main St or 35.1495,-90.0490" />
        </div>
        <div style={{marginTop:8}}>
          <label>Radius (miles): {radius}</label><br/>
          <input type="range" min="1" max="25" value={radius} onChange={e=>setRadius(e.target.value)} />
        </div>
        <div style={{marginTop:12}}>
          <button type="submit" style={{padding:'8px 12px'}}>Find competitors</button>
          <button type="button" onClick={suggestPrice} style={{padding:'8px 12px', marginLeft:8}}>Suggest price</button>
        </div>
      </form>

      {loading && <div>Working...</div>}
      {error && <div style={{color:'red'}}>{error}</div>}

      <section>
        <h2>Competitors ({competitors.length})</h2>
        {competitors.map((c,i)=>(
          <div key={i} style={{border:'1px solid #ddd', padding:10, marginBottom:8, borderRadius:6, display:'flex', justifyContent:'space-between'}}>
            <div>
              <div style={{fontWeight:600}}>{c.name}</div>
              <div style={{fontSize:13}}>{c.address} • {Number(c.distance||0).toFixed(1)} mi</div>
              <div style={{fontSize:13}}>Unit: {c.unit || '10x10'}</div>
              <div style={{fontSize:12}}>Source: {c.source || 'website'}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontWeight:700,fontSize:18}}>${c.price || '—'}</div>
              <div style={{fontSize:12}}>{c.availability||'unknown'}</div>
            </div>
          </div>
        ))}
      </section>

      <section style={{marginTop:16}}>
        <h2>Suggestion</h2>
        {suggestion ? (
          <div style={{padding:12,border:'1px solid #ddd',borderRadius:6}}>
            <div>Recommended base price: <strong>${suggestion.recommendedPrice}</strong></div>
            <div style={{marginTop:6}}>Rationale: {suggestion.rationale}</div>
            <div style={{marginTop:6,fontSize:12}}>Confidence: {Math.round((suggestion.confidence||0)*100)}%</div>
          </div>
        ) : <div>No suggestion yet.</div>}
      </section>

      <footer style={{marginTop:24,fontSize:12,color:'#666'}}>
        Note: This service scrapes public websites. Respect site terms and robots.txt.
      </footer>
    </div>
  );
}
