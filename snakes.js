// Minimal Multiplayer Snakes & Ladders (single file)
// Demo-friendly, LAN-play via shareable link
// Run: npm init -y && npm i express socket.io && node snakes.js

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const os = require("os");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// ---- In-memory game store ----
const games = new Map(); // id -> { id, creator, state:'lobby'|'playing'|'finished', players:[{id,name,color,pos}], turn, winner }
const COLORS = ["#e74c3c","#3498db","#2ecc71","#9b59b6","#f1c40f","#e67e22"];
const snakesLadders = {
  // Ladders
  2:38,7:14,8:31,15:26,21:42,28:84,36:44,51:67,71:91,78:98,
  // Snakes
  16:6,46:25,49:11,62:19,64:60,74:53,89:68,92:88,95:75,99:80
};

function makeId(n=6){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s=""; for(let i=0;i<n;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}
function pickColor(game){ return COLORS[game.players.length % COLORS.length]; }
function publicIPs(){
  const nets = os.networkInterfaces(); const out = [];
  for(const name of Object.keys(nets)){
    for(const net of nets[name]||[]){
      if(net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out.length? out : ["localhost"];
}
function sanitize(game){
  return {
    id: game.id,
    state: game.state,
    players: game.players.map(p=>({id:p.id,name:p.name,color:p.color,pos:p.pos})),
    turn: game.turn,
    current: game.players[game.turn]?.id,
    winner: game.winner || null
  };
}
function nextTurn(game){
  if (!game.players.length) return;
  game.turn = (game.turn + 1) % game.players.length;
}
function removePlayer(game, socketId){
  const idx = game.players.findIndex(p=>p.id===socketId);
  if(idx>=0){
    const wasTurn = (game.turn === idx);
    game.players.splice(idx,1);
    if (game.players.length===0){ game.state="lobby"; game.turn=0; return; }
    if (wasTurn){ game.turn = game.turn % game.players.length; }
  }
  if (game.creator === socketId && game.players.length) game.creator = game.players[0].id;
}

// ---- HTTP routes ----
app.get("/", (req,res)=>{
  res.type("html").send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Melbourne Plus – Snakes & Ladders (Demo)</title>
<style>
  :root{--bg:#0f172a;--card:#111827;--ink:#f8fafc;--muted:#94a3b8;--brand:#16a34a;}
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial;background:var(--bg);color:var(--ink);}
  .wrap{max-width:860px;margin:40px auto;padding:0 16px}
  header{display:flex;gap:16px;align-items:center;margin-bottom:24px}
  .pill{background:rgba(22,163,74,.15);color:#86efac;border:1px solid rgba(22,163,74,.4);padding:4px 10px;border-radius:999px;font-size:12px}
  .card{background:var(--card);border:1px solid #1f2937;border-radius:14px;padding:20px}
  button{background:var(--brand);color:#06240e;border:0;border-radius:10px;padding:12px 16px;font-weight:700;cursor:pointer}
  input[type=text]{width:100%;padding:12px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:var(--ink)}
  .row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  a.link{color:#93c5fd}
</style>
</head><body>
<div class="wrap">
  <header>
    <div class="pill">Melbourne Plus – community demo</div>
    <h2 style="margin:0 0 0 8px;">Snakes & Ladders</h2>
  </header>
  <div class="card">
    <p>This is a very simple multiplayer Snakes & Ladders for showcase sessions. Create a game and share the link.</p>
    <div class="row" style="margin-top:12px">
      <button id="create">Create Game</button>
      <div id="status" style="color:var(--muted)"></div>
    </div>
    <p style="margin-top:16px;font-size:14px;color:var(--muted)">Tip: people on the same Wi-Fi can join the printed IP link from your terminal.</p>
  </div>
  <div id="linkCard" class="card" style="display:none;margin-top:16px">
    <div class="row"><strong>Join Link:</strong> <a id="roomLink" class="link" href="#" target="_blank"></a>
      <button id="copyBtn">Copy</button></div>
  </div>
</div>
<script>
document.getElementById("create").onclick = async ()=>{
  const r = await fetch("/create").then(r=>r.json());
  const url = location.origin + "/g/" + r.id;
  document.getElementById("status").textContent = "Room created.";
  const a = document.getElementById("roomLink"); a.textContent = url; a.href = url;
  document.getElementById("linkCard").style.display = "block";
};
document.getElementById("copyBtn")?.addEventListener("click", ()=>{
  const txt = document.getElementById("roomLink").textContent;
  navigator.clipboard.writeText(txt); alert("Link copied!");
});
</script>
</body></html>`);
});

app.get("/create", (req,res)=>{
  const id = makeId();
  const game = { id, creator:null, state:"lobby", players:[], turn:0, winner:null };
  games.set(id, game);
  // Print helpful LAN join links
  const ips = publicIPs();
  console.log(`\n== New room ${id} ==`);
  ips.forEach(ip => console.log(`Join link: http://${ip}:${PORT}/g/${id}`));
  res.json({id});
});

app.get("/g/:id", (req,res)=>{
  const id = req.params.id.toUpperCase();
  if (!games.has(id)) {
    res.status(404).send("Room not found. Create one at /"); return;
  }
  res.type("html").send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Room ${id} – Snakes & Ladders</title>
<style>
  :root{--bg:#0f172a;--card:#111827;--ink:#f8fafc;--muted:#94a3b8;--brand:#16a34a;}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial;background:var(--bg);color:var(--ink)}
  .wrap{max-width:1100px;margin:20px auto;padding:0 16px}
  .row{display:flex;gap:16px;flex-wrap:wrap}
  .left{flex:1 1 520px}
  .right{flex:1 1 300px}
  .card{background:var(--card);border:1px solid #1f2937;border-radius:14px;padding:14px}
  input,button{font-size:14px}
  input[type=text]{width:100%;padding:10px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:var(--ink)}
  button{background:var(--brand);color:#06240e;border:0;border-radius:10px;padding:10px 12px;font-weight:700;cursor:pointer}
  #board{display:grid;grid-template-columns:repeat(10,48px);grid-template-rows:repeat(10,48px);gap:2px;user-select:none}
  .cell{width:48px;height:48px;background:#0b1220;border:1px solid #1f2937;display:flex;align-items:center;justify-content:center;position:relative;font-size:12px;color:#9ca3af}
  .cell:nth-child(odd){background:#0e1526}
  .tok{position:absolute;bottom:2px;left:2px;width:16px;height:16px;border-radius:50%;border:2px solid #000}
  .lad{position:absolute;inset:4px;border:1px dashed #38bdf8;opacity:.35;border-radius:8px}
  .snk{position:absolute;inset:8px;border:1px dashed #f87171;opacity:.35;border-radius:12px}
  .log{height:210px;overflow:auto;background:#0b1220;border:1px solid #1f2937;border-radius:10px;padding:8px;font-size:13px;color:#e5e7eb}
  .muted{color:var(--muted)}
  .badge{background:rgba(22,163,74,.15);color:#86efac;border:1px solid rgba(22,163,74,.4);padding:2px 8px;border-radius:999px;font-size:12px}
</style>
</head><body>
<div class="wrap">
  <div class="row">
    <div class="left card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div><strong>Snakes & Ladders</strong> • Room <span class="badge">${id}</span></div>
        <div id="share" class="muted" style="font-size:12px"></div>
      </div>
      <div id="board" style="margin-top:10px"></div>
    </div>
    <div class="right card">
      <div id="joinPane">
        <label class="muted">Your name</label>
        <input id="name" type="text" placeholder="e.g., Gurshan"/>
        <button id="joinBtn" style="margin-top:8px">Join Game</button>
      </div>
      <div id="gamePane" style="display:none">
        <div id="players"></div>
        <div class="muted" style="margin:8px 0">Turn: <span id="turn"></span></div>
        <button id="startBtn" style="display:none;margin-bottom:8px">Start Game</button>
        <button id="rollBtn" disabled>Roll Dice 🎲</button>
        <div style="margin-top:10px" class="log" id="log"></div>
      </div>
    </div>
  </div>
  <p class="muted" style="margin-top:10px;font-size:12px">Melbourne Plus demo: simple, fast, and friendly.</p>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
const roomId = "${id}";
const boardEl = document.getElementById("board");
const playersEl = document.getElementById("players");
const turnEl = document.getElementById("turn");
const logEl = document.getElementById("log");
const rollBtn = document.getElementById("rollBtn");
const startBtn = document.getElementById("startBtn");
const joinPane = document.getElementById("joinPane");
const gamePane = document.getElementById("gamePane");
const shareEl = document.getElementById("share");
shareEl.textContent = location.href;

const socket = io();
let me = { id:null, name:null };
let state = null;

// Build board (serpentine numbers 1..100)
const cells = [];
(function buildBoard(){
  // 10 rows, top row is 100..91
  let num = 100;
  for (let r=0;r<10;r++){
    const leftToRight = (r%2===0); // top row L->R (100..91)
    const row = [];
    for(let c=0;c<10;c++){
      const el = document.createElement("div");
      el.className="cell";
      const n = num - (leftToRight? c : (9-c));
      el.dataset.n = n;
      el.innerHTML = '<div>'+n+'</div>';
      // hint overlays
      if ([2,7,8,15,21,28,36,51,71,78].includes(n)) { const d=document.createElement('div'); d.className='lad'; el.appendChild(d); }
      if ([16,46,49,62,64,74,89,92,95,99].includes(n)) { const d=document.createElement('div'); d.className='snk'; el.appendChild(d); }
      boardEl.appendChild(el);
      row.push(el);
    }
    // prepare next row
    num -= 10;
    cells.push(row);
  }
})();

function cellEl(n){ return [...document.querySelectorAll('.cell')].find(e=>+e.dataset.n===n); }
function clearTokens(){
  document.querySelectorAll('.tok').forEach(e=>e.remove());
}
function drawTokens(){
  clearTokens();
  (state?.players||[]).forEach(p=>{
    const pos = p.pos || 0;
    const target = pos === 0 ? cellEl(1) : cellEl(pos);
    if (!target) return;
    const t = document.createElement('div');
    t.className = 'tok'; t.style.background = p.color; t.title = p.name + ' @ ' + pos;
    target.appendChild(t);
  });
}

function log(msg){ const p = document.createElement('div'); p.textContent = msg; logEl.appendChild(p); logEl.scrollTop = logEl.scrollHeight; }

document.getElementById("joinBtn").onclick = ()=>{
  const name = document.getElementById("name").value.trim();
  if(!name) return alert("Enter a name");
  socket.emit("join",{gameId:roomId,name});
};
startBtn.onclick = ()=> socket.emit("start", roomId);
rollBtn.onclick = ()=> socket.emit("roll", roomId);

socket.on("connect", ()=>{ me.id = socket.id; });
socket.on("err", m => alert(m));
socket.on("state", s=>{
  state = s;
  // panes
  const amIn = !!(s.players.find(p=>p.id===me.id));
  joinPane.style.display = amIn ? "none" : "block";
  gamePane.style.display = amIn ? "block" : "none";

  // show start for creator in lobby
  startBtn.style.display = (s.state==="lobby" && s.players[0]?.id===me.id) ? "inline-block" : "none";
  rollBtn.disabled = !(s.state==="playing" && s.current===me.id);

  // players list
  playersEl.innerHTML = s.players.map(p=>\`<div style="display:flex;align-items:center;gap:8px;margin:4px 0">
    <div style="width:12px;height:12px;border-radius:50%;background:\${p.color}"></div>
    <div>\${p.name}</div>
    <div class="muted" style="margin-left:auto">pos \${p.pos}</div>
  </div>\`).join("");

  // turn / winner
  const cur = s.players.find(p=>p.id===s.current);
  if (s.state==="finished"){
    turnEl.textContent = "Winner: " + (s.winner || "Unknown");
    rollBtn.disabled = true;
  } else {
    turnEl.textContent = cur ? cur.name : "—";
  }

  drawTokens();
});
socket.on("joined", ({name, creator})=>{
  log(\`\${name} joined the room.\`);
  if(creator) log(\`\${name} is the room owner.\`);
});
socket.on("started", ()=> log("Game started!"));
socket.on("rolled", ({name,roll,from,to,extra})=>{
  log(\`\${name} rolled \${roll} → \${to}\${extra?" (roll again!)":""}\`);
});
socket.on("snakeOrLadder", ({type,from,to})=>{
  log(\`\${type==="ladder"?"Ladder!":"Snake!"} \${from} → \${to}\`);
});
socket.on("won", ({name})=> log(\`\${name} wins! 🎉\`));
</script>
</body></html>`);
});

// ---- Socket.IO handlers ----
io.on("connection", (socket)=>{
  socket.on("join", ({gameId, name})=>{
    const id = (gameId||"").toUpperCase();
    const game = games.get(id);
    if (!game) return socket.emit("err","Room not found.");
    if (game.state === "finished") return socket.emit("err","Game already finished.");
    socket.join(id);
    if (!game.creator) game.creator = socket.id;
    const player = { id: socket.id, name: name?.substring(0,20)||"Player", color: pickColor(game), pos: 0 };
    game.players.push(player);
    io.to(id).emit("joined", {name: player.name, creator: player.id===game.creator});
    io.to(id).emit("state", sanitize(game));
  });

  socket.on("start", (id)=>{
    const game = games.get((id||"").toUpperCase());
    if (!game) return;
    if (socket.id !== game.creator) return; // only owner starts
    if (game.players.length < 1) return;
    game.state = "playing";
    game.turn = 0;
    io.to(id).emit("started");
    io.to(id).emit("state", sanitize(game));
  });

  socket.on("roll", (id)=>{
    const game = games.get((id||"").toUpperCase());
    if (!game || game.state!=="playing") return;
    const cur = game.players[game.turn];
    if (!cur || socket.id !== cur.id) return; // not your turn

    const roll = 1 + Math.floor(Math.random()*6);
    let from = cur.pos || 0;
    let to = from + roll;

    // must land exactly on 100
    if (to > 100) to = from;

    // snakes or ladders
    if (to !== from && snakesLadders[to]){
      const target = snakesLadders[to];
      io.to(id).emit("snakeOrLadder", { type: target>to? "ladder":"snake", from: to, to: target });
      to = target;
    }

    cur.pos = to;
    io.to(id).emit("rolled", {name: cur.name, roll, from, to, extra:(roll===6 && to!==100)});

    if (to === 100){
      game.state = "finished";
      game.winner = cur.name;
      io.to(id).emit("won", {name: cur.name});
      io.to(id).emit("state", sanitize(game));
      return;
    }

    // extra turn on 6 (if not already won)
    if (roll !== 6){
      nextTurn(game);
    }
    io.to(id).emit("state", sanitize(game));
  });

  socket.on("disconnect", ()=>{
    // remove player from any game
    for (const game of games.values()){
      const wasIn = game.players.some(p=>p.id===socket.id);
      if (!wasIn) continue;
      removePlayer(game, socket.id);
      io.to(game.id).emit("state", sanitize(game));
    }
  });
});

// ---- Start server ----
server.listen(PORT, ()=>{
  console.log(`\nSnakes & Ladders server running on http://localhost:${PORT}`);
  console.log("Create a game at / and share the printed Join Link.");
});