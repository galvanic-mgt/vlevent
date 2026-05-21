<!doctype html>
<html lang="zh-HK">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>投票 · 公眾畫面</title>
  <style>
    :root {
      --panel: rgba(12, 14, 20, 0.82);
      --border: rgba(255,255,255,.12);
      --accent: #ffd84d;
    }
    html,body{height:100%} body{margin:0;background:#0b0d12;color:#fff;font-family:"Inter","Noto Sans",system-ui,-apple-system,Segoe UI,Roboto,sans-serif; position:relative;}
    #publicBg{position:fixed; inset:0; z-index:0; background:#0b0d12;}
    .stage{position:relative; min-height:100%; display:grid; grid-template-columns: 340px 1fr; gap:18px; padding:24px; z-index:1;}
    @media (max-width: 960px){ .stage{grid-template-columns:1fr; padding:16px} }
    .panel{background:var(--panel); border-radius:18px; padding:16px; border:1px solid var(--border); box-shadow:0 14px 40px rgba(0,0,0,.35);}
    .qrBox{display:flex;flex-direction:column;align-items:center;justify-content:center; gap:10px; min-height:320px;}
    .qrLink{word-break:break-all; opacity:.7; font-size:14px; margin-top:8px}
    .title{font-size:clamp(22px, 2.8vw, 36px); margin:0 0 16px}
    .bars{display:flex; flex-direction:column; gap:12px}
    .barRow{display:grid; grid-template-columns:70px 1fr; gap:12px; align-items:center;}
    .barThumb{width:70px; height:70px; border-radius:14px; background:rgba(255,255,255,.08); border:1px solid var(--border); display:grid; place-items:center; font-weight:700; font-size:18px; color:rgba(255,255,255,.8); background-size:cover; background-position:center;}
    .barWrap{background:rgba(255,255,255,.06); border-radius:14px; overflow:hidden; border:1px solid var(--border); display:flex; align-items:center; min-height:64px;}
    .barFill{height:100%; display:flex; align-items:center; padding:0 14px; transition:width .5s ease; background:linear-gradient(90deg, rgba(255,216,77,.18), rgba(255,139,95,.22)); font-weight:700;}
    .barLabel{margin-left:auto; padding-right:12px; opacity:.85; font-weight:600;}
    .meta{opacity:.8; margin-top:10px}
    .hidden{display:none}
    .footer{position:absolute; left:0; right:0; bottom:0; padding:10px 20px; display:flex; justify-content:space-between; opacity:.6; font-size:12px; z-index:2;}
    .fit{width:100%; height:100%}
    .brandRow{display:grid; grid-template-columns: 120px 1fr; gap:12px; align-items:center; margin-bottom:12px;}
    .brandLogo{width:120px; height:120px; border-radius:18px; background:#0f1625; border:1px solid var(--border); display:grid; place-items:center; font-weight:700; letter-spacing:1px; background-size:contain; background-position:center; background-repeat:no-repeat;}
    .brandBanner{width:100%; min-height:120px; border-radius:18px; background:#0f1625; border:1px solid var(--border); display:grid; place-items:center; color:rgba(255,255,255,.6); background-size:cover; background-position:center;}
    /* Result animation (vertical bars) */
    .resultsWrap{display:grid; gap:14px;}
    .resultChart{display:grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); align-items:end; gap:12px; min-height:320px;}
    .rBar{position:relative; background:rgba(255,255,255,.08); border:1px solid var(--border); border-radius:12px; padding:10px; display:flex; flex-direction:column; align-items:center; gap:8px;}
    .rFillWrap{width:100%; height:240px; display:flex; align-items:flex-end;}
    .rFill{width:100%; background:linear-gradient(180deg, rgba(255,216,77,.4), rgba(255,139,95,.6)); border-radius:10px; height:0; transition:height .8s ease;}
    .rLabel{font-size:14px; text-align:center; min-height:36px;}
    .rCount{font-weight:700; margin-top:4px;}
    .crown{position:absolute; top:-32px; font-size:84px; opacity:0; transition:opacity .4s ease;}
    .resultsStatus{font-size:14px; opacity:.8;}
  </style>
</head>
<body>
  <div id="publicBg"></div>
  <div class="stage">
    <!-- Left: QR (can be hidden by ui.showPollQR=false) -->
    <div id="qrPanel" class="panel qrBox">
      <div id="qr"></div>
      <div id="qrLink" class="qrLink"></div>
    </div>

    <!-- Right: poll content -->
    <div class="panel">
      <div class="brandRow">
        <div id="boardLogo" class="brandLogo">LOGO</div>
        <div id="boardBanner" class="brandBanner">Banner</div>
      </div>
      <h1 id="pollQ" class="title">投票</h1>
      <div id="bars" class="bars"></div>
      <div id="resultArea" class="resultsWrap hidden">
        <div id="resultChart" class="resultChart"></div>
        <div id="resultStatus" class="resultsStatus"></div>
      </div>
      <div id="total" class="meta"></div>
      <!-- Optional: an empty area you can overlay like the lucky draw canvas if desired -->
      <canvas id="fxCanvas" class="fit hidden"></canvas>
    </div>
  </div>

  <div class="footer">
    <span id="footLeft"></span>
    <span>投票系統</span>
  </div>

  <script src="./qrcode.min.js"></script>
  <script type="module" src="./src/polls_public_board.js"></script>
</body>
</html>
