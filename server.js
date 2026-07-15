<div id="csafx-ai-coach"> <style> html, body { margin: 0 !important; padding: 0 !important; overflow-x: hidden !important; background: #020403 !important; } #csafx-ai-coach { font-family: Inter, Arial, sans-serif; color: #ffffff; background: #020403; min-height: 100vh; width: 100vw; position: relative; left: 50%; right: 50%; margin-left: -50vw; margin-right: -50vw; overflow-x: hidden; padding-top: 84px; box-sizing: border-box; } #csafx-ai-coach *, #csafx-ai-coach *:before, #csafx-ai-coach *:after { box-sizing: border-box; } #csafx-ai-coach button, #csafx-ai-coach select, #csafx-ai-coach textarea { font-family: inherit; } .csa-wrap { width: 100%; max-width: 1880px; margin: 0 auto; padding: 0 24px; } .csa-topbar { position: fixed; top: 0; left: 0; right: 0; width: 100vw; z-index: 999999; background: rgba(5, 8, 12, 0.97); border-bottom: 1px solid rgba(255, 255, 255, 0.08); backdrop-filter: blur(16px); box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45); } .csa-nav { min-height: 84px; display: flex; align-items: center; justify-content: space-between; gap: 24px; } .csa-brand { display: flex; align-items: center; gap: 12px; min-width: 220px; flex-shrink: 0; } .csa-logo { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; background: #00c985; color: #04120d; font-weight: 950; font-size: 20px; letter-spacing: -0.06em; } .csa-brand-title { font-size: 21px; font-weight: 950; line-height: 1.05; letter-spacing: -0.03em; } .csa-brand-title span { display: block; margin-top: 4px; color: #00c985; font-size: 12px; font-weight: 800; } .csa-nav-links { display: flex; align-items: center; gap: 42px; color: #9aa6b8; font-size: 16px; font-weight: 900; flex: 1; justify-content: center; } .csa-nav-links a { color: inherit; text-decoration: none; cursor: pointer; transition: 0.2s ease; } .csa-nav-links a:hover { color: #ffffff; } .csa-nav-actions { display: flex; align-items: center; gap: 16px; flex-shrink: 0; } .csa-login { color: #d0d8e5; text-decoration: none; font-weight: 900; cursor: pointer; font-size: 16px; } .csa-btn { border: 0; cursor: pointer; font-weight: 950; transition: 0.2s ease; padding: 16px 24px; font-size: 15px; line-height: 1; } .csa-btn-green { background: #00c985; color: #04110c; } .csa-btn-green:hover { background: #00e699; transform: translateY(-1px); } .csa-btn-dark { background: #08101b; color: #ffffff; border: 1px solid rgba(255,255,255,0.12); } .csa-btn-dark:hover { border-color: rgba(127,124,255,0.45); } .csa-hero { background: radial-gradient(circle at 72% 10%, rgba(79, 82, 255, 0.16), transparent 28%), radial-gradient(circle at 18% 45%, rgba(0, 201, 133, 0.10), transparent 26%), #020403; padding: 36px 0 54px; width: 100%; } .csa-hero-grid { display: grid; grid-template-columns: minmax(260px, 0.50fr) minmax(980px, 2.10fr); gap: 22px; align-items: start; width: 100%; } .csa-hero-left { padding-top: 22px; min-width: 0; max-width: 500px; } .csa-right-column { display: grid; gap: 22px; min-width: 0; width: 100%; } .csa-alert-pill { display: inline-flex; align-items: center; gap: 10px; color: #ff4d73; border: 1px solid rgba(255, 77, 115, 0.45); background: rgba(255, 77, 115, 0.08); border-radius: 999px; padding: 10px 16px; font-size: 12px; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 26px; } .csa-hero h1 { font-size: clamp(42px, 4.5vw, 84px); line-height: 0.98; letter-spacing: -0.078em; margin: 0 0 18px; max-width: 500px; } .csa-hero h1 span { color: #ff4d73; } .csa-subline { color: #c9d5e4; line-height: 1.55; font-size: 17px; margin: 0 0 22px; max-width: 500px; } .csa-subline strong { color: #00c985; } .csa-bullets { list-style: none; margin: 0 0 28px; padding: 0; display: grid; gap: 16px; max-width: 500px; } .csa-bullets li { display: grid; grid-template-columns: 24px 1fr; gap: 12px; color: #e4ebf5; font-size: 16px; line-height: 1.55; } .csa-checkmark { color: #00c985; font-weight: 950; } .csa-hero-buttons { display: grid; gap: 12px; max-width: 500px; margin: 28px 0 24px; } .csa-wide-btn { width: 100%; text-align: center; font-size: 18px; padding: 20px 28px; } .csa-trust-note { background: rgba(127, 124, 255, 0.08); border: 1px solid rgba(127, 124, 255, 0.28); border-radius: 14px; padding: 16px; max-width: 500px; margin: 0 0 24px; color: #dce6f4; line-height: 1.55; font-size: 14px; } .csa-trust-note strong { display: block; color: #ffffff; margin-bottom: 6px; font-size: 15px; } .csa-sample-verdict { background: #08101b; border: 1px solid rgba(64,88,130,0.55); border-radius: 16px; padding: 18px; max-width: 500px; margin-bottom: 24px; } .csa-sample-verdict h3 { margin: 0 0 12px; color: #00c985; font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; } .csa-sample-verdict .csa-verdict-word { font-size: 30px; font-weight: 950; margin: 0 0 8px; color: #ffd447; } .csa-sample-verdict p { color: #d9e4f2; margin: 0; line-height: 1.55; font-size: 14px; } .csa-process { margin-top: 26px; max-width: 500px; } .csa-process-title { color: #78879b; text-transform: uppercase; font-size: 12px; letter-spacing: 0.16em; margin-bottom: 12px; } .csa-process-list { display: grid; gap: 10px; } .csa-process-row { display: grid; grid-template-columns: 38px 1fr; gap: 12px; align-items: center; border: 1px solid rgba(56, 98, 160, 0.45); background: rgba(5, 9, 17, 0.92); border-radius: 8px; padding: 11px 14px; color: #d9e4f2; font-size: 13px; font-weight: 800; } .csa-process-row span { color: #7d91b0; font-family: monospace; } .csa-green-text { color: #00c985; } .csa-purple-text { color: #7f7cff; } .csa-red-text { color: #ff4d73; } .csa-yellow-text { color: #ffd447; } .csa-stats-mini { display: flex; justify-content: space-between; max-width: 500px; margin-top: 28px; align-items: end; color: #ffffff; font-weight: 950; font-size: 20px; gap: 12px; } .csa-stats-mini small { display: block; color: #758397; font-size: 11px; font-weight: 800; margin-top: 4px; text-transform: uppercase; line-height: 1.4; } .csa-workspace, .csa-profile-panel, .csa-system-panel { background: #060b12; border: 1px solid rgba(58, 79, 114, 0.58); border-radius: 24px; padding: 28px; width: 100%; min-width: 0; box-shadow: 0 30px 90px rgba(0, 0, 0, 0.28); } .csa-workspace { min-height: 780px; box-shadow: 0 30px 90px rgba(0, 0, 0, 0.45); } .csa-workspace-head { display: flex; justify-content: space-between; align-items: center; padding: 0 2px 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 22px; gap: 12px; } .csa-workspace-title { font-weight: 950; color: #ffffff; display: flex; align-items: center; gap: 10px; font-size: 22px; line-height: 1.2; } .csa-mini-tag { border: 1px solid rgba(107, 109, 255, 0.3); color: #8f9cff; padding: 9px 14px; border-radius: 4px; font-size: 12px; font-family: monospace; white-space: nowrap; } .csa-diagnostic-grid { display: grid; grid-template-columns: minmax(620px, 1.95fr) minmax(290px, 0.72fr); gap: 26px; align-items: start; width: 100%; } .csa-main-panel, .csa-side-stack { min-width: 0; width: 100%; } .csa-side-stack { display: grid; gap: 20px; } .csa-chart-card { background: #03060b; border-radius: 18px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06); min-height: 430px; position: relative; display: grid; place-items: center; width: 100%; } .csa-upload-zone { width: 100%; min-height: 430px; display: grid; place-items: center; text-align: center; padding: 28px; cursor: pointer; background: linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px), #03060b; background-size: 44px 44px; } .csa-upload-zone:hover { background-color: #07101a; } .csa-upload-icon { width: 74px; height: 74px; display: grid; place-items: center; margin: 0 auto 14px; border-radius: 18px; background: rgba(0, 201, 133, 0.12); color: #00c985; font-size: 36px; font-weight: 900; } .csa-upload-zone h3 { margin: 0 0 8px; font-size: 24px; letter-spacing: -0.04em; } .csa-upload-zone p { margin: 0 0 18px; color: #9aaabd; max-width: 520px; } #chartFile { display: none; } .csa-chart-preview { display: none; width: 100%; height: auto; min-height: auto; padding: 16px 16px 86px; background: #03060b; position: relative; } .csa-chart-preview img { display: block; width: 100%; max-height: 540px; object-fit: contain; border-radius: 12px; background: #ffffff; border: 1px solid rgba(255,255,255,0.08); } .csa-chart-card.csa-has-chart { min-height: auto; place-items: stretch; } .csa-chart-card.csa-has-chart .csa-chart-preview { min-height: auto; } .csa-expand-chart-btn { position: absolute; top: 28px; right: 28px; z-index: 8; border: 1px solid rgba(255,255,255,0.18); background: rgba(3, 6, 11, 0.82); color: #ffffff; border-radius: 999px; padding: 10px 13px; font-size: 13px; font-weight: 950; cursor: pointer; backdrop-filter: blur(12px); box-shadow: 0 10px 28px rgba(0,0,0,0.35); } .csa-expand-chart-btn:hover { background: rgba(0, 201, 133, 0.18); border-color: rgba(0, 201, 133, 0.45); color: #00c985; transform: translateY(-1px); } .csa-chart-modal { position: fixed; inset: 0; z-index: 1000000; display: none; align-items: center; justify-content: center; padding: 28px; background: rgba(0, 0, 0, 0.88); backdrop-filter: blur(8px); } .csa-chart-modal.open { display: flex; } .csa-chart-modal-inner { position: relative; width: min(96vw, 1500px); max-height: 92vh; background: #03060b; border: 1px solid rgba(255,255,255,0.14); border-radius: 18px; padding: 18px; box-shadow: 0 30px 90px rgba(0,0,0,0.70); } .csa-chart-modal-head { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 0 0 12px; color: #dbe7f5; font-size: 13px; font-weight: 900; } .csa-chart-modal-close { border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06); color: #ffffff; border-radius: 10px; padding: 10px 13px; cursor: pointer; font-weight: 950; } .csa-chart-modal-close:hover { border-color: rgba(255,77,115,0.55); color: #ff4d73; } .csa-chart-modal img { width: 100%; max-height: 82vh; object-fit: contain; border-radius: 12px; background: #ffffff; border: 1px solid rgba(255,255,255,0.08); } .csa-run-overlay { position: absolute; left: 32px; bottom: 24px; display: none; } .csa-form { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin: 18px 0; width: 100%; } .csa-field { display: grid; gap: 7px; min-width: 0; } .csa-field label { color: #8ea1ba; font-size: 13px; font-weight: 900; } .csa-field select, .csa-field textarea, .csa-field input { width: 100%; background: #040810; color: #ffffff; border: 1px solid rgba(88,114,158,0.55); border-radius: 10px; padding: 14px 14px; outline: none; font-size: 15px; min-width: 0; } .csa-field textarea { min-height: 94px; resize: vertical; } .csa-field-full { grid-column: 1 / -1; } .csa-action-row { display: flex; gap: 12px; flex-wrap: wrap; } .csa-status { color: #00c985; font-size: 13px; font-weight: 900; margin-top: 12px; display: none; } .csa-feedback-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; width: 100%; } .csa-feedback-card { background: #040910; border: 1px solid rgba(64,88,130,0.55); border-radius: 14px; padding: 18px; min-height: 170px; } .csa-feedback-card h4 { margin: 0 0 12px; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; display: flex; align-items: center; gap: 8px; } .csa-feedback-card ul { margin: 0; padding-left: 18px; color: #dce6f4; font-size: 14px; line-height: 1.55; } .csa-feedback-card li { margin-bottom: 7px; } .csa-plan { background: #050a12; border: 1px solid rgba(64,88,130,0.55); border-radius: 14px; padding: 20px; margin-top: 18px; min-height: 130px; width: 100%; } .csa-plan h4 { color: #7f7cff; margin: 0 0 10px; font-size: 15px; } .csa-plan p { margin: 0; color: #c8d6e8; line-height: 1.65; font-size: 14px; }

.csa-plan-text {
  color: #c8d6e8;
  line-height: 1.75;
  font-size: 14px;
  display: grid;
  gap: 14px;
}

.csa-plan-text p {
  margin: 0;
}

.csa-plan-text .csa-ai-section {
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.075);
  border-radius: 14px;
  padding: 15px 16px;
}

.csa-plan-text .csa-ai-heading {
  color: #00c985;
  font-weight: 950;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.10em;
  margin-bottom: 9px;
}

.csa-plan-text .csa-ai-body {
  color: #dbe7f5;
  line-height: 1.72;
}

.csa-plan-text .csa-ai-body p + p {
  margin-top: 9px;
}

.csa-plan-text ul {
  margin: 8px 0 0;
  padding-left: 18px;
}

.csa-plan-text li {
  margin-bottom: 7px;
}

.csa-plan-text li:last-child {
  margin-bottom: 0;
}

.csa-plan-text .csa-ai-note {
  color: #9aaabd;
  font-size: 13px;
}

.csa-read-more-details {
  margin-top: 14px;
  border: 1px solid rgba(0, 201, 133, 0.24);
  border-radius: 14px;
  background: rgba(0, 201, 133, 0.035);
  overflow: hidden;
}

.csa-read-more-details summary {
  list-style: none;
  cursor: pointer;
  padding: 14px 16px;
  color: #00c985;
  font-weight: 950;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.10em;
  border-bottom: 1px solid transparent;
  user-select: none;
}

.csa-read-more-details summary::-webkit-details-marker {
  display: none;
}

.csa-read-more-details summary:hover {
  background: rgba(0, 201, 133, 0.075);
}

.csa-read-more-details[open] summary {
  border-bottom-color: rgba(0, 201, 133, 0.16);
}

.csa-read-more-details summary::before {
  content: "+ ";
  color: #ffffff;
}

.csa-read-more-details[open] summary::before {
  content: "− ";
}

.csa-read-more-content {
  padding: 14px;
  display: grid;
  gap: 14px;
}
 .csa-context-box, .csa-grade-card, .csa-score-box, .csa-mistake-hub, .csa-system-card { background: #08101b; border: 1px solid rgba(64,88,130,0.55); border-radius: 16px; width: 100%; } .csa-context-box { padding: 18px; color: #dbe7f5; font-size: 14px; line-height: 1.55; } .csa-context-box.good { border-color: rgba(0, 201, 133, 0.40); background: rgba(0, 201, 133, 0.075); } .csa-context-box.warn { border-color: rgba(255, 212, 71, 0.40); background: rgba(255, 212, 71, 0.075); } .csa-context-box.bad { border-color: rgba(255, 77, 115, 0.40); background: rgba(255, 77, 115, 0.075); } .csa-context-box h4 { margin: 0 0 10px; color: #ffffff; } .csa-grade-card { padding: 26px; text-align: center; } .csa-grade-card small { display: block; color: #8192ab; letter-spacing: 0.14em; font-weight: 950; font-size: 12px; margin-bottom: 16px; } .csa-grade-ring { width: 124px; height: 124px; margin: 0 auto; border-radius: 50%; background: radial-gradient(circle at center, #08101b 0 52%, transparent 53%), conic-gradient(#00c985 0deg, #00c985 0deg, #132033 0deg); display: grid; place-items: center; color: #ffffff; font-size: 30px; font-weight: 950; } .csa-grade-ring span { display: block; font-size: 12px; color: #8597b1; margin-top: 4px; } .csa-score-box { padding: 20px; } .csa-score-row { margin-bottom: 18px; } .csa-score-row:last-child { margin-bottom: 0; } .csa-score-top { display: flex; justify-content: space-between; gap: 10px; color: #d8e3f1; font-size: 13px; font-weight: 900; margin-bottom: 8px; } .csa-bar { height: 8px; background: #121b2b; border-radius: 999px; overflow: hidden; } .csa-bar span { display: block; height: 100%; width: 0%; background: #00c985; border-radius: 999px; transition: width 0.4s ease; } .csa-mistake-hub { padding: 20px; } .csa-mistake-hub h4 { color: #ff4d73; margin: 0 0 14px; font-size: 15px; letter-spacing: 0.06em; text-transform: uppercase; } .csa-mistake-list { display: grid; gap: 10px; } .csa-mistake-item { display: grid; grid-template-columns: 18px 1fr auto; gap: 10px; align-items: center; background: rgba(255, 77, 115, 0.055); border: 1px solid rgba(255, 77, 115, 0.18); border-radius: 8px; padding: 11px 10px; color: #f2dbe2; font-size: 12px; font-weight: 800; } .csa-risk-tag { color: #ff738e; background: rgba(255, 77, 115, 0.14); border-radius: 4px; padding: 4px 6px; font-size: 9px; text-transform: uppercase; white-space: nowrap; } .csa-error { display: none; background: rgba(255,77,115,0.10); color: #ff8ca3; border: 1px solid rgba(255,77,115,0.30); border-radius: 10px; padding: 12px; margin-bottom: 14px; font-size: 13px; line-height: 1.5; } .csa-profile-panel { background: radial-gradient(circle at 15% 20%, rgba(0, 201, 133, 0.15), transparent 26%), radial-gradient(circle at 80% 10%, rgba(127, 124, 255, 0.14), transparent 30%), #060b12; } .csa-profile-head, .csa-system-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-bottom: 22px; } .csa-profile-head h2, .csa-system-head h2 { margin: 0; font-size: clamp(26px, 2.2vw, 40px); line-height: 1.08; letter-spacing: -0.055em; } .csa-profile-head p, .csa-system-head p { margin: 8px 0 0; color: #aab8c9; line-height: 1.55; max-width: 820px; } .csa-live-badge { color: #00c985; background: rgba(0, 201, 133, 0.11); border: 1px solid rgba(0, 201, 133, 0.28); border-radius: 999px; padding: 10px 14px; font-size: 12px; font-weight: 950; text-transform: uppercase; white-space: nowrap; } .csa-profile-grid, .csa-system-grid { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 16px; } .csa-profile-card, .csa-system-card { background: rgba(8, 16, 27, 0.88); border: 1px solid rgba(64,88,130,0.55); border-radius: 16px; padding: 20px; min-height: 210px; } .csa-profile-card h3, .csa-system-card h3 { margin: 0 0 14px; font-size: 15px; text-transform: uppercase; letter-spacing: 0.08em; color: #dce6f4; } .csa-pattern { display: grid; gap: 10px; } .csa-pattern-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 14px; color: #d9e4f2; font-size: 13px; font-weight: 850; } .csa-mini-bar { height: 7px; background: #121b2b; border-radius: 999px; overflow: hidden; margin-top: 7px; } .csa-mini-bar span { display: block; height: 100%; border-radius: 999px; background: #ff4d73; } .csa-focus-list, .csa-rule-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 11px; } .csa-focus-list li, .csa-rule-list li { display: grid; grid-template-columns: 24px 1fr; gap: 10px; color: #d9e4f2; font-size: 14px; line-height: 1.45; } .csa-journal-preview { overflow: hidden; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); } .csa-journal-row { display: grid; grid-template-columns: 0.8fr 0.8fr 1.2fr 0.6fr; gap: 10px; padding: 12px 12px; font-size: 12px; color: #d9e4f2; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(3, 6, 11, 0.62); } .csa-journal-row:first-child { color: #8ea1ba; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 900; background: rgba(0, 201, 133, 0.08); } .csa-journal-row:last-child { border-bottom: 0; } .csa-system-panel { background: radial-gradient(circle at 82% 25%, rgba(255, 77, 115, 0.12), transparent 26%), radial-gradient(circle at 14% 70%, rgba(0, 201, 133, 0.10), transparent 26%), #060b12; } .csa-system-card.big { grid-column: span 2; } .csa-flow { display: grid; gap: 12px; } .csa-flow-step { display: grid; grid-template-columns: 48px 1fr; gap: 14px; align-items: center; background: rgba(3, 6, 11, 0.58); border: 1px solid rgba(255,255,255,0.07); border-radius: 14px; padding: 14px; } .csa-flow-num { width: 38px; height: 38px; border-radius: 12px; background: rgba(0,201,133,0.12); color: #00c985; display: grid; place-items: center; font-weight: 950; } .csa-flow-step strong { display: block; margin-bottom: 3px; color: #ffffff; } .csa-flow-step span { color: #9aaabd; font-size: 13px; line-height: 1.45; } .csa-coach-output { border-radius: 14px; border: 1px solid rgba(255,255,255,0.08); overflow: hidden; background: #03060b; } .csa-output-row { display: grid; grid-template-columns: 130px 1fr; gap: 12px; padding: 13px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; color: #d9e4f2; } .csa-output-row:last-child { border-bottom: 0; } .csa-output-row strong { color: #8ea1ba; text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; } .csa-metric-stack { display: grid; gap: 12px; } .csa-metric-box { background: rgba(3,6,11,0.58); border: 1px solid rgba(255,255,255,0.07); border-radius: 14px; padding: 16px; } .csa-metric-box strong { display: block; color: #00c985; font-size: 28px; margin-bottom: 4px; } .csa-metric-box span { color: #aab8c9; font-size: 13px; line-height: 1.4; } .csa-section { padding: 82px 0; background: #020403; border-top: 1px solid rgba(255,255,255,0.06); width: 100%; } .csa-section:nth-of-type(even) { background: #05080d; } .csa-section-head { text-align: center; max-width: 820px; margin: 0 auto 36px; } .csa-section-head h2 { margin: 0 0 14px; font-size: clamp(34px, 5vw, 56px); line-height: 1.05; letter-spacing: -0.06em; } .csa-section-head p { color: #aab8c9; line-height: 1.65; margin: 0; font-size: 16px; } .csa-card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; width: 100%; } .csa-info-card { background: #08101b; border: 1px solid rgba(64,88,130,0.55); border-radius: 16px; padding: 24px; min-height: 190px; } .csa-info-icon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: rgba(0,201,133,0.12); color: #00c985; font-weight: 950; margin-bottom: 18px; } .csa-info-card h3 { margin: 0 0 10px; font-size: 19px; } .csa-info-card p { margin: 0; color: #aab8c9; line-height: 1.6; font-size: 14px; } .csa-checklist-card { background: linear-gradient(145deg, rgba(0,201,133,0.08), #08101b); border-color: rgba(0,201,133,0.28); } .csa-dashboard-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; width: 100%; } .csa-dashboard-tile { background: #08101b; border: 1px solid rgba(64,88,130,0.55); border-radius: 16px; padding: 22px; min-height: 150px; } .csa-dashboard-tile strong { font-size: 38px; color: #00c985; display: block; margin-bottom: 8px; line-height: 1; } .csa-dashboard-tile h3 { margin: 0 0 8px; font-size: 16px; } .csa-dashboard-tile p { margin: 0; color: #aab8c9; font-size: 13px; line-height: 1.55; } .csa-before-after { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 26px; } .csa-before-after-card { background: #08101b; border: 1px solid rgba(64,88,130,0.55); border-radius: 18px; padding: 26px; } .csa-before-after-card h3 { margin: 0 0 16px; font-size: 24px; letter-spacing: -0.04em; } .csa-before-after-card ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; } .csa-before-after-card li { color: #d9e4f2; font-size: 15px; line-height: 1.5; display: grid; grid-template-columns: 26px 1fr; gap: 10px; } .csa-pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; width: 100%; } .csa-price-card { background: #08101b; border: 1px solid rgba(64,88,130,0.55); border-radius: 18px; padding: 26px; } .csa-price-card.featured { border-color: rgba(0,201,133,0.55); background: linear-gradient(145deg, rgba(0,201,133,0.12), #08101b); transform: translateY(-8px); } .csa-price-card h3 { margin: 0 0 8px; font-size: 22px; } .csa-price-card p { color: #aab8c9; margin: 0 0 18px; line-height: 1.55; font-size: 14px; } .csa-price { font-size: 44px; font-weight: 950; margin-bottom: 18px; } .csa-price span { color: #8492a5; font-size: 14px; } .csa-price-list { list-style: none; padding: 0; margin: 0 0 22px; display: grid; gap: 11px; } .csa-price-list li { color: #d9e4f2; font-size: 14px; }  .csa-popular-badge {    display: inline-flex;    align-items: center;    color: #04110c;    background: #00c985;    border-radius: 999px;    padding: 8px 12px;    font-size: 11px;    font-weight: 950;    margin-bottom: 14px;  }  .csa-faq-section {    padding-top: 72px;  }  .csa-faq-grid {    display: grid;    grid-template-columns: repeat(2, 1fr);    gap: 14px;    max-width: 1200px;    margin: 0 auto;  }  .csa-faq-card {    background: #08101b;    border: 1px solid rgba(64,88,130,0.55);    border-radius: 14px;    padding: 18px;  }  .csa-faq-card h3 {    margin: 0 0 8px;    color: #ffffff;    font-size: 16px;    letter-spacing: -0.02em;  }  .csa-faq-card p {    margin: 0;    color: #aab8c9;    font-size: 13px;    line-height: 1.6;  }  .csa-footer {    background: #020403;    border-top: 1px solid rgba(255,255,255,0.08);    padding: 30px 0;  }  .csa-footer-inner {    display: flex;    align-items: center;    justify-content: space-between;    gap: 20px;    color: #7e8da3;    font-size: 13px;  }  .csa-footer strong {    color: #ffffff;    display: block;    margin-bottom: 5px;  }  .csa-footer span {    display: block;    color: #7e8da3;  }  @media (max-width: 1500px) { .csa-hero-grid { grid-template-columns: minmax(250px, 0.56fr) minmax(760px, 1.95fr); } .csa-diagnostic-grid { grid-template-columns: minmax(0, 1.70fr) minmax(280px, 0.78fr); } .csa-profile-grid, .csa-system-grid { grid-template-columns: 1fr 1fr; } .csa-profile-card:last-child { grid-column: 1 / -1; } .csa-system-card.big { grid-column: 1 / -1; } } @media (max-width: 1180px) { .csa-hero-grid { grid-template-columns: 1fr; } .csa-hero-left, .csa-hero h1, .csa-subline, .csa-bullets, .csa-hero-buttons, .csa-trust-note, .csa-sample-verdict, .csa-process, .csa-stats-mini { max-width: 100%; } .csa-workspace { width: 100%; } } @media (max-width: 980px) { #csafx-ai-coach { padding-top: 78px; } .csa-nav-links { display: none; } .csa-diagnostic-grid, .csa-feedback-grid, .csa-card-grid, .csa-dashboard-grid, .csa-pricing-grid, .csa-faq-grid, .csa-form, .csa-profile-grid, .csa-system-grid, .csa-before-after { grid-template-columns: 1fr; } .csa-profile-card:last-child, .csa-system-card.big { grid-column: auto; } .csa-nav-actions .csa-login { display: none; } .csa-workspace { min-height: auto; } .csa-chart-card, .csa-upload-zone { min-height: 360px; } .csa-chart-card.csa-has-chart, .csa-chart-card.csa-has-chart .csa-chart-preview { min-height: auto; } .csa-chart-preview { padding-bottom: 74px; } .csa-chart-preview img { max-height: 420px; } .csa-workspace, .csa-profile-panel, .csa-system-panel { padding: 20px; } .csa-expand-chart-btn { top: 24px; right: 24px; } } @media (max-width: 620px) { .csa-wrap { padding: 0 16px; } .csa-nav { min-height: 74px; } .csa-brand-title { font-size: 14px; } .csa-brand-title span { font-size: 10px; } .csa-logo { width: 36px; height: 36px; font-size: 16px; } .csa-nav-actions .csa-btn { padding: 12px 14px; font-size: 12px; } .csa-hero h1 { font-size: 42px; } .csa-workspace-title { font-size: 18px; } .csa-mini-tag, .csa-live-badge { display: none; } .csa-journal-row, .csa-output-row { grid-template-columns: 1fr; } } 

/* CSA Coach: clearer loading state + reset old analysis when a new chart is loaded */
.csa-chart-card.csa-is-analyzing {
  position: relative;
  box-shadow: 0 0 0 1px rgba(0,201,133,0.35), 0 0 34px rgba(0,201,133,0.18);
}
.csa-analysis-loading-overlay {
  display: none;
  position: absolute;
  inset: 0;
  z-index: 25;
  align-items: center;
  justify-content: center;
  padding: 22px;
  border-radius: 18px;
  background: rgba(2, 6, 12, 0.78);
  backdrop-filter: blur(4px);
  text-align: center;
}
.csa-chart-card.csa-is-analyzing .csa-analysis-loading-overlay {
  display: flex;
}
.csa-loading-card {
  width: min(420px, 92%);
  border: 1px solid rgba(0,201,133,0.38);
  background: linear-gradient(145deg, rgba(0,201,133,0.12), rgba(8,16,27,0.96));
  border-radius: 18px;
  padding: 24px 22px;
  color: #dbe7f5;
  box-shadow: 0 24px 70px rgba(0,0,0,0.42);
}
.csa-loading-spinner {
  width: 46px;
  height: 46px;
  margin: 0 auto 14px;
  border-radius: 50%;
  border: 4px solid rgba(255,255,255,0.16);
  border-top-color: #00c985;
  animation: csaSpin 0.8s linear infinite;
}
.csa-loading-title {
  color: #ffffff;
  font-size: 18px;
  font-weight: 950;
  margin-bottom: 7px;
}
.csa-loading-text {
  color: #aab8c9;
  font-size: 14px;
  line-height: 1.5;
}
.csa-btn.csa-loading-btn,
button.csa-loading-btn {
  position: relative;
  opacity: 0.92;
  cursor: wait !important;
  box-shadow: 0 0 0 1px rgba(0,201,133,0.35), 0 0 24px rgba(0,201,133,0.22);
}
.csa-status-running {
  border-color: rgba(0,201,133,0.46) !important;
  background: rgba(0,201,133,0.11) !important;
  color: #dffcf1 !important;
}
@keyframes csaSpin {
  to { transform: rotate(360deg); }
}

</style> <div class="csa-topbar"> <div class="csa-wrap"> <div class="csa-nav"> <div class="csa-brand"> <div class="csa-logo">CS</div> <div class="csa-brand-title"> CSAFOREX <span>ai trading coach</span> </div> </div> <div class="csa-nav-links"> <a onclick="csaScrollTo('process')">The Process</a> <a onclick="csaScrollTo('features')">Features</a> <a onclick="csaScrollTo('dashboard')">Dashboard</a> <a onclick="csaScrollTo('pricing')">Pricing</a> <a onclick="csaScrollTo('faq')">FAQ</a> </div> <div class="csa-nav-actions"> <a class="csa-login">Log in</a> <button class="csa-btn csa-btn-green" onclick="csaScrollTo('coach')">Fix Your Trading Mistakes</button> </div> </div> </div> </div> <section class="csa-hero" id="process"> <div class="csa-wrap"> <div class="csa-hero-grid"> <div class="csa-hero-left"> <div class="csa-alert-pill">⊙ Stop losing capital to bad habits</div> <h1>Stop Repeating The <span>Same Trading Mistakes.</span></h1> <p class="csa-subline"> Upload your chart and let <strong>CSA Coach</strong> show you what you did right, what you did wrong, and what to fix before the next trade. </p> <ul class="csa-bullets"> <li><span class="csa-checkmark">◎</span><span>Get a clear trade breakdown covering entry, stop loss, target, risk, and execution quality.</span></li> <li><span class="csa-checkmark">◎</span><span>Find repeated habits like chasing entries, entering into resistance, or ignoring clean retests.</span></li> <li><span class="csa-checkmark">◎</span><span>Turn every chart review into a journal entry that tracks your recurring trading mistakes.</span></li> </ul> <div class="csa-hero-buttons"> <button class="csa-btn csa-btn-green csa-wide-btn" onclick="csaScrollTo('coach')">↥ Upload Your Last Trade</button> <button class="csa-btn csa-btn-dark csa-wide-btn" onclick="csaScrollTo('coach')">✣ See Coach In Action</button> </div> <div class="csa-trust-note"> <strong>Not signals. Coaching.</strong> CSA Coach does not predict the market or give random trade signals. It reviews your chart, your execution, and your discipline so you can stop repeating the same mistakes. </div> <div class="csa-sample-verdict"> <h3>Sample AI Verdict</h3> <div class="csa-verdict-word">WAIT</div> <p><strong>Reason:</strong> Price is in the middle of the range. No clean retest yet.</p> <p><strong>Fix:</strong> Wait for price to return to the marked support zone before considering entry.</p> </div> <div class="csa-process"> <div class="csa-process-title">How your AI coach builds consistency</div> <div class="csa-process-list"> <div class="csa-process-row"><span>01</span><div>Securely processes your uploaded trading screenshot</div></div> <div class="csa-process-row"><span>02</span><div><b class="csa-purple-text">Checks if the setup matches your support and resistance framework</b></div></div> <div class="csa-process-row"><span>03</span><div><b class="csa-green-text">Scores structure, execution, and risk quality</b></div></div> <div class="csa-process-row"><span>04</span><div><b class="csa-red-text">Highlights the exact technical or behavioral mistake</b></div></div> <div class="csa-process-row"><span>05</span><div>Turns each review into a simple trading journal entry</div></div> <div class="csa-process-row"><span>06</span><div><b class="csa-yellow-text">Tracks your repeated mistakes over time</b></div></div> <div class="csa-process-row"><span>07</span><div><b>Gives you one clear improvement focus for the next trade</b></div></div> </div> </div> <div class="csa-stats-mini"> <div> <div class="csa-green-text">★★★★★</div> <small>Built to catch the habits traders repeat most.</small> </div> <div style="text-align:right;"> S/R <small>rule-based trade review</small> </div> </div> </div> <div class="csa-right-column"> <div class="csa-workspace" id="coach"> <div class="csa-workspace-head"> <div class="csa-workspace-title">⌁ Real Trade Feedback Workspace</div> <div class="csa-mini-tag">CSA Framework Review</div> </div> <div class="csa-error" id="errorBox"></div> <div class="csa-diagnostic-grid"> <div class="csa-main-panel"> <div class="csa-chart-card"> <div class="csa-upload-zone" id="uploadBox"> <div> <div class="csa-upload-icon">↥</div> <h3>Upload Chart Screenshot</h3> <p>Click here, drag your TradingView / MT4 / MT5 chart image, or paste a screenshot with Ctrl + V.</p> <button class="csa-btn csa-btn-green" type="button">Choose Chart</button><p style="margin-top:12px;font-size:12px;color:#7f8fa6;">Tip: copy a chart screenshot, click this page, then press Ctrl + V.</p> </div> </div> <input type="file" id="chartFile" accept="image/png,image/jpeg,image/jpg,image/webp"> <div class="csa-chart-preview" id="previewWrap"> <button class="csa-expand-chart-btn" id="expandChartBtn" type="button" aria-label="Expand chart preview" title="Expand chart">⛶ Expand</button> <img id="chartPreview" alt="Uploaded chart preview"> </div> <div class="csa-run-overlay" id="runOverlay"> <button class="csa-btn csa-btn-green" id="analyzeOverlayBtn" type="button">Run AI Diagnostics ⊙</button> </div> </div> <div class="csa-form"> <div class="csa-field"> <label>Trade Mode</label> <select id="analysisType"> <option value="pre-trade">Pre-trade analysis</option> <option value="post-trade" selected>Post-trade review</option> </select> </div> <div class="csa-field"> <label>Pair / Instrument</label> <select id="pair"> <option value="EURUSD" selected>EURUSD</option> <option value="GBPUSD">GBPUSD</option> <option value="EURCHF">EURCHF</option> <option value="EURGBP">EURGBP</option> <option value="GBPJPY">GBPJPY</option> <option value="USDJPY">USDJPY</option> <option value="USDCHF">USDCHF</option> <option value="USDCAD">USDCAD</option> <option value="AUDUSD">AUDUSD</option> <option value="NZDUSD">NZDUSD</option> <option value="XAUUSD">XAUUSD / Gold</option> <option value="BTCUSD">BTCUSD</option> <option value="Other">Other</option> </select> </div> <div class="csa-field"> <label>Timeframe</label> <select id="timeframe"> <option value="M1">M1</option> <option value="M5" selected>M5</option> <option value="M15">M15</option> <option value="M30">M30</option> <option value="H1">H1</option> <option value="H4">H4</option> <option value="D1">D1</option> <option value="W1">W1</option> <option value="MN">MN</option> </select> </div> <div class="csa-field"> <label>Chart / Trade Date</label> <input type="date" id="chartDate" required> </div> <div class="csa-field csa-field-full"> <label>Trade Notes</label> <textarea id="userNotes" placeholder="Example: Entry was at support retest. Stop loss below low. Target next resistance."></textarea> </div> </div> <div class="csa-action-row"> <button class="csa-btn csa-btn-green" id="analyzeBtn" type="button">Run AI Diagnostics ⊙</button> <button class="csa-btn csa-btn-dark" id="resetBtn" type="button">Upload Another</button> </div> <div class="csa-status" id="statusBox"></div> <div class="csa-feedback-grid"> <div class="csa-feedback-card"> <h4 class="csa-green-text">◎ Strengths</h4> <ul id="strengthsList"> <li>Good support/resistance identification will appear here.</li> <li>Strong reaction candle feedback will appear here.</li> <li>Risk-reward strengths will appear here.</li> </ul> </div> <div class="csa-feedback-card"> <h4 class="csa-red-text">⊗ Weaknesses</h4> <ul id="weaknessesList"> <li>Entry mistakes will appear here.</li> <li>Stop loss issues will appear here.</li> <li>Trade management problems will appear here.</li> </ul> </div> </div> <div class="csa-plan"> <h4>Coach Analysis:</h4> <div id="coachPlanText" class="csa-plan-text"><div class="csa-ai-section"><div class="csa-ai-body">Upload a chart to get a clean CSA area identification based on the most recent Monday-to-Friday data visible on the chart.</div></div></div> </div> </div> <div class="csa-side-stack"> <div class="csa-context-box warn" id="contextBox"> <h4>Chart Context Check</h4> <p><b>Selected:</b> <span id="selectedContext">EURUSD / M5</span></p> <p><b>AI detected:</b> <span id="detectedContext">Waiting for chart</span></p> <p><b>Status:</b> <span id="contextStatus">Not analyzed yet</span></p> </div> <div class="csa-grade-card"> <small>Overall Grade</small> <div class="csa-grade-ring" id="gradeRing"> <div> <div id="gradeText">--</div> <span id="confidenceText">0/100</span> </div> </div> </div> <div class="csa-score-box"> <div class="csa-score-row"> <div class="csa-score-top"><span>Setup Quality</span><span id="structureScoreText">0/100</span></div> <div class="csa-bar"><span id="structureBar"></span></div> </div> <div class="csa-score-row"> <div class="csa-score-top"><span>Entry Accuracy</span><span id="executionScoreText">0/100</span></div> <div class="csa-bar"><span id="executionBar" style="background:#7f7cff;"></span></div> </div> <div class="csa-score-row"> <div class="csa-score-top"><span>Risk Management</span><span id="riskScoreText">0/100</span></div> <div class="csa-bar"><span id="riskBar" style="background:#00c985;"></span></div> </div> </div> <div class="csa-mistake-hub"> <h4>AI Mistake Detection Hub</h4> <div class="csa-mistake-list" id="mistakeList"> <div class="csa-mistake-item"><span>▴</span><span>Entered too early</span><span class="csa-risk-tag">High Risk</span></div> <div class="csa-mistake-item"><span>▴</span><span>Stop loss too tight</span><span class="csa-risk-tag">Warning</span></div> <div class="csa-mistake-item"><span>▴</span><span>Entry into resistance</span><span class="csa-risk-tag">Structural</span></div> <div class="csa-mistake-item"><span>▴</span><span>Risk-to-reward below plan</span><span class="csa-risk-tag">Math Flaw</span></div> <div class="csa-mistake-item"><span>▴</span><span>Failed to wait for confirmation</span><span class="csa-risk-tag">Discipline</span></div> </div> </div> </div> </div> </div> <div class="csa-profile-panel"> <div class="csa-profile-head"> <div> <h2>Your AI Coach Builds A Mistake Profile Over Time.</h2> <p>After each chart upload, the coach tracks repeated mistakes, assigns weekly focus areas, and turns your reviews into a simple trading journal.</p> </div> <div class="csa-live-badge">Live Product Preview</div> </div> <div class="csa-profile-grid"> <div class="csa-profile-card"> <h3 class="csa-red-text">Mistake Pattern</h3> <div class="csa-pattern"> <div> <div class="csa-pattern-row"><span>Entering before confirmation</span><span>78%</span></div> <div class="csa-mini-bar"><span style="width:78%;"></span></div> </div> <div> <div class="csa-pattern-row"><span>Stop loss too tight</span><span>64%</span></div> <div class="csa-mini-bar"><span style="width:64%;background:#ffd447;"></span></div> </div> <div> <div class="csa-pattern-row"><span>Trading into resistance</span><span>51%</span></div> <div class="csa-mini-bar"><span style="width:51%;background:#7f7cff;"></span></div> </div> <div> <div class="csa-pattern-row"><span>Poor risk-to-reward</span><span>43%</span></div> <div class="csa-mini-bar"><span style="width:43%;background:#00c985;"></span></div> </div> </div> </div> <div class="csa-profile-card"> <h3 class="csa-green-text">Next 7-Day Focus</h3> <ul class="csa-focus-list"> <li><span class="csa-checkmark">01</span><span>Wait for a confirmed retest before entry.</span></li> <li><span class="csa-checkmark">02</span><span>Mark D1/W1 levels before dropping to lower timeframe.</span></li> <li><span class="csa-checkmark">03</span><span>Only enter near clean flip zones, not in the middle.</span></li> <li><span class="csa-checkmark">04</span><span>Target minimum 1:3 risk-to-reward before taking trade.</span></li> </ul> </div> <div class="csa-profile-card"> <h3 class="csa-purple-text">Mini Journal Preview</h3> <div class="csa-journal-preview"> <div class="csa-journal-row"> <span>Pair</span> <span>Mode</span> <span>Main Lesson</span> <span>Grade</span> </div> <div class="csa-journal-row"> <span>GBPUSD</span> <span>Post</span> <span>Waited too late after first retest</span> <span>B-</span> </div> <div class="csa-journal-row"> <span>XAUUSD</span> <span>Pre</span> <span>Price too close to resistance</span> <span>C</span> </div> <div class="csa-journal-row"> <span>EURUSD</span> <span>Post</span> <span>Good zone, weak risk placement</span> <span>B+</span> </div> </div> </div> </div> </div> <div class="csa-system-panel"> <div class="csa-system-head"> <div> <h2>From One Chart Review To A Repeatable Improvement System.</h2> <p>This section fills the space with product value: it shows users that CSA Coach is not only analyzing one chart, it is building a repeatable process for better decision-making.</p> </div> <div class="csa-live-badge">Improvement Engine</div> </div> <div class="csa-system-grid"> <div class="csa-system-card big"> <h3 class="csa-green-text">What Happens After Each Upload</h3> <div class="csa-flow"> <div class="csa-flow-step"> <div class="csa-flow-num">1</div> <div> <strong>Chart is reviewed against your framework</strong> <span>The AI checks clean support/resistance levels, flip zones, retests, entry timing, stop placement, and target quality.</span> </div> </div> <div class="csa-flow-step"> <div class="csa-flow-num">2</div> <div> <strong>Your mistake is named clearly</strong> <span>Instead of vague feedback, the coach tells the trader the exact issue: early entry, weak retest, poor stop, bad location, or poor reward.</span> </div> </div> <div class="csa-flow-step"> <div class="csa-flow-num">3</div> <div> <strong>The next trade gets one focus</strong> <span>The user leaves with one clear action to improve, not a long confusing report.</span> </div> </div> </div> </div> <div class="csa-system-card"> <h3 class="csa-yellow-text">Coach Output Example</h3> <div class="csa-coach-output"> <div class="csa-output-row"> <strong>Verdict</strong> <span>WAIT</span> </div> <div class="csa-output-row"> <strong>Reason</strong> <span>No clean retest. Price is sitting too close to resistance.</span> </div> <div class="csa-output-row"> <strong>Risk</strong> <span>Stop placement would be too tight and vulnerable.</span> </div> <div class="csa-output-row"> <strong>Fix</strong> <span>Wait for price to return to the support zone and confirm rejection.</span> </div> </div> </div> <div class="csa-system-card"> <h3 class="csa-purple-text">What Users Track</h3> <div class="csa-metric-stack"> <div class="csa-metric-box"> <strong>Entry Discipline</strong> <span>Are they entering at the right area or chasing the move?</span> </div> <div class="csa-metric-box"> <strong>Risk Quality</strong> <span>Is the stop loss placed beyond invalidation or too close?</span> </div> <div class="csa-metric-box"> <strong>Setup Quality</strong> <span>Does the trade match the support/resistance framework?</span> </div> </div> </div> <div class="csa-system-card"> <h3 class="csa-red-text">Rules The Coach Checks</h3> <ul class="csa-rule-list"> <li><span>✓</span><span>Is price near a clean support or resistance zone?</span></li> <li><span>✓</span><span>Did support flip into resistance or resistance flip into support?</span></li> <li><span>✓</span><span>Was there a proper retest before entry?</span></li> <li><span>✓</span><span>Is the stop loss beyond invalidation?</span></li> <li><span>✓</span><span>Is the target realistic and worth the risk?</span></li> </ul> </div> </div> </div> </div> </div> </div> </section> <section class="csa-section" id="features"> <div class="csa-wrap"> <div class="csa-section-head"> <h2>Features that make the coach feel practical.</h2> <p>The tool should not just “talk.” It should diagnose trading mistakes visually, score performance, and give the trader a clear next action.</p> </div> <div class="csa-card-grid"> <div class="csa-info-card"> <div class="csa-info-icon">01</div> <h3>Chart context verification</h3> <p>AI checks the uploaded chart against the user-selected pair and timeframe to warn about possible mismatches.</p> </div> <div class="csa-info-card"> <div class="csa-info-icon">02</div> <h3>Support & resistance review</h3> <p>Feedback is based on clean levels, flip zones, retests, stop loss placement, and next key target zones.</p> </div> <div class="csa-info-card"> <div class="csa-info-icon">03</div> <h3>Execution scoring</h3> <p>Each chart receives structure, execution, risk, and confidence scores so traders can measure improvement.</p> </div> <div class="csa-info-card"> <div class="csa-info-icon">04</div> <h3>Mistake detection hub</h3> <p>The dashboard highlights common mistakes like chasing entries, entering into resistance, or using poor RR.</p> </div> <div class="csa-info-card"> <div class="csa-info-icon">05</div> <h3>Journal-ready output</h3> <p>The AI returns strengths, weaknesses, coach advice, risk comments, lessons, and tags for easy journaling.</p> </div> <div class="csa-info-card csa-checklist-card"> <div class="csa-info-icon">06</div> <h3>What the coach checks</h3> <p>Clean S/R zones, flip levels, retests, stop loss beyond invalidation, target quality, and risk-to-reward.</p> </div> </div> <div class="csa-before-after"> <div class="csa-before-after-card"> <h3 class="csa-red-text">Before CSA Coach</h3> <ul> <li><span>✕</span><span>Guessing entries without a clear retest.</span></li> <li><span>✕</span><span>Moving stops emotionally after entry.</span></li> <li><span>✕</span><span>Chasing trades after the move has already started.</span></li> <li><span>✕</span><span>Not knowing why the same mistake keeps repeating.</span></li> </ul> </div> <div class="csa-before-after-card"> <h3 class="csa-green-text">After CSA Coach</h3> <ul> <li><span>✓</span><span>Waiting for confirmed support/resistance retests.</span></li> <li><span>✓</span><span>Placing stops beyond clear invalidation points.</span></li> <li><span>✓</span><span>Only trading clean zones with enough reward potential.</span></li> <li><span>✓</span><span>Tracking repeated mistakes and fixing one habit at a time.</span></li> </ul> </div> </div> </div> </section> <section class="csa-section" id="dashboard"> <div class="csa-wrap"> <div class="csa-section-head"> <h2>Dashboard built for consistency.</h2> <p>These dashboard cards show how traders can track their behavior, not just individual trade outcomes.</p> </div> <div class="csa-dashboard-grid"> <div class="csa-dashboard-tile"> <strong>78%</strong> <h3>Average Execution</h3> <p>Track entry discipline, retest patience, and confirmation quality.</p> </div> <div class="csa-dashboard-tile"> <strong>42</strong> <h3>Trades Reviewed</h3> <p>Monitor total pre-trade and post-trade reviews completed.</p> </div> <div class="csa-dashboard-tile"> <strong>6</strong> <h3>Recurring Mistakes</h3> <p>Spot repeated technical and behavioral weaknesses quickly.</p> </div> <div class="csa-dashboard-tile"> <strong>2.8R</strong> <h3>Avg Planned RR</h3> <p>Check whether setups offer enough reward before execution.</p> </div> <div class="csa-dashboard-tile"> <strong>B+</strong> <h3>Current Grade</h3> <p>See the trader’s average performance grade over time.</p> </div> <div class="csa-dashboard-tile"> <strong>31%</strong> <h3>Chase Rate</h3> <p>Measure how often the trader enters before confirmation.</p> </div> <div class="csa-dashboard-tile"> <strong>64%</strong> <h3>Valid Setup Rate</h3> <p>Track how often uploaded trades match the CSA framework.</p> </div> <div class="csa-dashboard-tile"> <strong>Weekly</strong> <h3>Coach Review</h3> <p>Summarize mistakes and assign one focus area for the week.</p> </div> </div> </div> </section> 
<section class="csa-section" id="pricing">
  <div class="csa-wrap">
    <div class="csa-section-head">
      <h2>Pricing that sells improvement, not features.</h2>
      <p>Simple plans for traders who want better execution and a personal trading feedback loop.</p>
    </div>

    <div class="csa-pricing-grid">
      <div class="csa-price-card">
        <h3>Starter</h3>
        <p>For traders testing the coach.</p>

        <div class="csa-price">$0<span>/mo</span></div>

        <ul class="csa-price-list">
          <li>✓ 3 coach reviews monthly</li>
          <li>✓ Basic coach verdict</li>
          <li>✓ Manual journal</li>
        </ul>

        <button class="csa-btn csa-btn-dark" onclick="csaScrollTo('coach')">Start Free</button>
      </div>

      <div class="csa-price-card featured">
        <div class="csa-popular-badge">Most popular</div>

        <h3>Pro</h3>
        <p>For serious traders building consistency.</p>

        <div class="csa-price">$29<span>/mo</span></div>

        <ul class="csa-price-list">
          <li>✓ Unlimited coach reviews</li>
          <li>✓ Pre & post-trade modes</li>
          <li>✓ Automatic journal</li>
          <li>✓ Progress dashboard</li>
        </ul>

        <button class="csa-btn csa-btn-green" onclick="csaScrollTo('coach')">Start Pro →</button>
      </div>

      <div class="csa-price-card">
        <h3>Elite</h3>
        <p>For power users and future custom strategies.</p>

        <div class="csa-price">$59<span>/mo</span></div>

        <ul class="csa-price-list">
          <li>✓ Everything in Pro</li>
          <li>✓ Strategy profiles</li>
          <li>✓ Weekly coach report</li>
          <li>✓ Priority support</li>
        </ul>

        <button class="csa-btn csa-btn-dark" onclick="csaScrollTo('coach')">Join Elite</button>
      </div>
    </div>
  </div>
</section>

<section class="csa-section csa-faq-section" id="faq">
  <div class="csa-wrap">
    <div class="csa-section-head">
      <h2>FAQ</h2>
      <p>Clear answers for traders before they upload their first chart.</p>
    </div>

    <div class="csa-faq-grid">
      <div class="csa-faq-card">
        <h3>Does CSA Coach predict trades?</h3>
        <p>No. CSA Coach focuses on execution, discipline, risk, and rule-following instead of market prediction.</p>
      </div>

      <div class="csa-faq-card">
        <h3>Whose strategy does it use?</h3>
        <p>It uses the CSA Framework. Later, advanced users may be able to add custom strategy onboarding.</p>
      </div>

      <div class="csa-faq-card">
        <h3>Can it analyze ICT, SMC, or Elliott Wave charts?</h3>
        <p>Yes, but the feedback depends on the selected coaching mode. CSA mode reviews the chart against CSA rules, not random chart markings.</p>
      </div>

      <div class="csa-faq-card">
        <h3>Is this connected to AI yet?</h3>
        <p>The frontend is ready for upload and response display. Your Render backend handles the AI analysis and returns the coach feedback.</p>
      </div>

      <div class="csa-faq-card">
        <h3>Can I upload any market?</h3>
        <p>The goal is to support forex, gold, crypto, stocks, and commodities as long as the instrument, timeframe, and chart date are clear.</p>
      </div>

      <div class="csa-faq-card">
        <h3>Does it work for pre-trade and post-trade review?</h3>
        <p>Yes. Pre-trade mode helps identify structure and areas of interest. Post-trade mode helps review execution and repeated mistakes.</p>
      </div>

      <div class="csa-faq-card">
        <h3>Will it tell me where to buy or sell?</h3>
        <p>No. CSA Coach is a coaching and review tool. It highlights structure, bias, risk, and mistakes without giving financial advice or guaranteed signals.</p>
      </div>

      <div class="csa-faq-card">
        <h3>What makes it different from a normal AI chatbot?</h3>
        <p>It is structured around your trading framework, chart upload workflow, journal-style feedback, mistake tagging, and dashboard improvement loop.</p>
      </div>

      <div class="csa-faq-card">
        <h3>Can it save my reviews into a journal?</h3>
        <p>That is part of the product direction. The dashboard is designed so each chart review can become a journal entry and mistake profile.</p>
      </div>

      <div class="csa-faq-card">
        <h3>Can I cancel or upgrade later?</h3>
        <p>Yes. The plan structure is designed so users can start free, upgrade to Pro, and move to Elite when they need deeper review and support.</p>
      </div>
    </div>
  </div>
</section>

<footer class="csa-footer">
  <div class="csa-wrap csa-footer-inner">
    <div>
      <strong>CSA Coach™</strong>
      <span>AI trading mentor for disciplined execution.</span>
    </div>

    <div>© 2026 CSA Coach. Trade better. Every session.</div>
  </div>
</footer>


<div class="csa-chart-modal" id="chartModal" aria-hidden="true">
  <div class="csa-chart-modal-inner" role="dialog" aria-modal="true" aria-label="Expanded chart preview">
    <div class="csa-chart-modal-head">
      <span>Expanded Chart Preview</span>
      <button class="csa-chart-modal-close" id="closeChartModal" type="button">Close ✕</button>
    </div>
    <img id="chartModalImg" alt="Expanded uploaded chart preview">
  </div>
</div>

<script> function csaScrollTo(id) { var el = document.getElementById(id); if (el) { var y = el.getBoundingClientRect().top + window.pageYOffset - 96; window.scrollTo({ top: y, behavior: "smooth" }); } } (function () { var API_URL = "https://csa-coach-backend.onrender.com/analyze-chart"; var uploadBox = document.getElementById("uploadBox"); var chartFile = document.getElementById("chartFile"); var chartPreview = document.getElementById("chartPreview"); var previewWrap = document.getElementById("previewWrap"); var chartCard = document.querySelector(".csa-chart-card"); var expandChartBtn = document.getElementById("expandChartBtn"); var chartModal = document.getElementById("chartModal"); var chartModalImg = document.getElementById("chartModalImg"); var closeChartModal = document.getElementById("closeChartModal"); var runOverlay = document.getElementById("runOverlay"); var analyzeBtn = document.getElementById("analyzeBtn"); var analyzeOverlayBtn = document.getElementById("analyzeOverlayBtn"); var resetBtn = document.getElementById("resetBtn"); var errorBox = document.getElementById("errorBox"); var statusBox = document.getElementById("statusBox"); var pair = document.getElementById("pair"); var timeframe = document.getElementById("timeframe"); var analysisType = document.getElementById("analysisType"); var userNotes = document.getElementById("userNotes"); var chartDate = document.getElementById("chartDate"); var selectedContext = document.getElementById("selectedContext"); var detectedContext = document.getElementById("detectedContext"); var contextStatus = document.getElementById("contextStatus"); var contextBox = document.getElementById("contextBox"); var gradeText = document.getElementById("gradeText"); var confidenceText = document.getElementById("confidenceText"); var gradeRing = document.getElementById("gradeRing"); var structureScoreText = document.getElementById("structureScoreText"); var executionScoreText = document.getElementById("executionScoreText"); var riskScoreText = document.getElementById("riskScoreText"); var structureBar = document.getElementById("structureBar"); var executionBar = document.getElementById("executionBar"); var riskBar = document.getElementById("riskBar"); var strengthsList = document.getElementById("strengthsList"); var weaknessesList = document.getElementById("weaknessesList"); var mistakeList = document.getElementById("mistakeList"); var coachPlanText = document.getElementById("coachPlanText"); var selectedFile = null; if (chartDate && !chartDate.value) { chartDate.value = new Date().toISOString().slice(0, 10); } function getSelectedContextText() { return pair.value + " / " + timeframe.value + (chartDate && chartDate.value ? " / " + chartDate.value : ""); }

function ensureLoadingOverlay() {
  if (!chartCard) return null;
  var existing = document.getElementById("csaAnalysisLoadingOverlay");
  if (existing) return existing;

  var overlay = document.createElement("div");
  overlay.id = "csaAnalysisLoadingOverlay";
  overlay.className = "csa-analysis-loading-overlay";
  overlay.innerHTML =
    '<div class="csa-loading-card">' +
      '<div class="csa-loading-spinner" aria-hidden="true"></div>' +
      '<div class="csa-loading-title">AI diagnostics running...</div>' +
      '<div class="csa-loading-text">Reading the chart, checking the selected pair/timeframe, and preparing the coach feedback. Please wait.</div>' +
    '</div>';
  chartCard.appendChild(overlay);
  return overlay;
}

function clearPreviousAnalysisForNewChart(source) {
  resetDashboard();
  hideError();
  setLoadingState(false);

  var actionText = source === "pasted" ? "New pasted chart loaded" : source === "dropped" ? "New dropped chart loaded" : "New uploaded chart loaded";
  detectedContext.textContent = "Waiting for new analysis";
  contextStatus.textContent = "New chart loaded";
  coachPlanText.innerHTML =
    '<div class="csa-ai-section"><div class="csa-ai-heading">New chart ready</div>' +
    '<div class="csa-ai-body">Previous feedback has been cleared. Click Run AI Diagnostics to analyze this new chart.</div></div>';
  setStatus(actionText + ". Previous feedback cleared. Click Run AI Diagnostics.");
}

function openChartModal() {
  if (!chartPreview || !chartPreview.src || !chartModal || !chartModalImg) return;
  chartModalImg.src = chartPreview.src;
  chartModal.classList.add("open");
  chartModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function closeExpandedChart() {
  if (!chartModal) return;
  chartModal.classList.remove("open");
  chartModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}
if (expandChartBtn) { expandChartBtn.addEventListener("click", function (e) { e.stopPropagation(); openChartModal(); }); }
if (closeChartModal) { closeChartModal.addEventListener("click", closeExpandedChart); }
if (chartModal) { chartModal.addEventListener("click", function (e) { if (e.target === chartModal) closeExpandedChart(); }); }
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeExpandedChart(); });
uploadBox.addEventListener("click", function () {
  chartFile.click();
});

uploadBox.addEventListener("dragover", function (e) {
  e.preventDefault();
});

uploadBox.addEventListener("drop", function (e) {
  e.preventDefault();
  handleFile(e.dataTransfer.files[0], "dropped");
});

chartFile.addEventListener("change", function (event) {
  handleFile(event.target.files[0], "uploaded");
});

document.addEventListener("paste", function (event) {
  var clipboardData = event.clipboardData || window.clipboardData;
  if (!clipboardData || !clipboardData.items) return;

  var imageFile = null;

  for (var i = 0; i < clipboardData.items.length; i++) {
    var item = clipboardData.items[i];
    if (item && item.type && item.type.indexOf("image/") === 0) {
      imageFile = item.getAsFile();
      break;
    }
  }

  if (!imageFile) return;

  event.preventDefault();

  var ext = imageFile.type && imageFile.type.indexOf("png") !== -1 ? "png" : "jpg";
  var pastedFile = new File(
    [imageFile],
    "pasted-chart-" + new Date().toISOString().replace(/[:.]/g, "-") + "." + ext,
    { type: imageFile.type || "image/png" }
  );

  handleFile(pastedFile, "pasted");
});

analyzeBtn.addEventListener("click", runAnalysis);
analyzeOverlayBtn.addEventListener("click", runAnalysis);

resetBtn.addEventListener("click", function () {
  selectedFile = null;
  chartFile.value = "";
  chartPreview.src = "";
  if (chartModalImg) chartModalImg.src = "";
  closeExpandedChart();
  previewWrap.style.display = "none";
  uploadBox.style.display = "grid";
  runOverlay.style.display = "none";
  if (chartCard) {
    chartCard.classList.remove("csa-has-chart");
  }
  userNotes.value = "";
  hideError();
  setStatus("Ready for a new chart. Upload, drag, or paste with Ctrl + V.");
  resetDashboard();
});

function handleFile(file, source) {
  if (!file) return;

  if (!file.type || !file.type.startsWith("image/")) {
    showError("Please upload or paste a valid chart image.");
    return;
  }

  selectedFile = file;
  clearPreviousAnalysisForNewChart(source);

  var reader = new FileReader();
  reader.onload = function (e) {
    chartPreview.src = e.target.result;
    if (chartModalImg) chartModalImg.src = e.target.result;
    uploadBox.style.display = "none";
    previewWrap.style.display = "block";
    if (chartCard) {
      chartCard.classList.add("csa-has-chart");
    }
    runOverlay.style.display = "block";
    hideError();

    var actionText = source === "pasted" ? "Chart pasted" : source === "dropped" ? "Chart dropped" : "Chart uploaded";
    setStatus(actionText + ". Previous feedback cleared. Click Run AI Diagnostics.");

    selectedContext.textContent = getSelectedContextText();
  };

  reader.onerror = function () {
    showError("Could not read the chart image. Please try another screenshot.");
  };

  reader.readAsDataURL(file);
}

async function runAnalysis(e) {
      if (e) e.stopPropagation();
      if (analyzeBtn && analyzeBtn.disabled) return;

      if (!selectedFile) {
        showError("Please upload a chart screenshot first.");
        return;
      }

      if (!chartDate || !chartDate.value) {
        showError("Please select the chart/trade date so CSA Coach can fetch the correct Monday-to-Friday market data.");
        return;
      }

      hideError();
      setStatus("Preparing chart image...");
      setLoadingState(true);

      selectedContext.textContent = getSelectedContextText();
      coachPlanText.innerHTML =
        '<div class="csa-ai-section"><div class="csa-ai-heading">Analyzing chart</div><div class="csa-ai-body">Reading the uploaded chart and organizing the CSA area identification into cleaner sections...</div></div>';

      try {
        var formData = new FormData();

        // IMPORTANT:
        // The backend expects the uploaded file field to be named "chart".
        // Do not send this request as JSON. It must be multipart/form-data.
        formData.append("chart", selectedFile);
        formData.append("instrument", pair.value);
        formData.append("pair", pair.value);
        formData.append("selectedPair", pair.value);
        formData.append("timeframe", timeframe.value);
        formData.append("selectedTimeframe", timeframe.value);
        formData.append("analysisType", analysisType.value);
        formData.append("tradeMode", analysisType.value);
        formData.append("notes", userNotes.value || "");
        formData.append("userNotes", userNotes.value || "");
        formData.append("chartDate", chartDate.value || "");
        formData.append("tradeDate", chartDate.value || "");
        formData.append("timezone", "UTC");

        setStatus("Fetching market data and running CSA diagnostics... please wait.");

        var response = await fetch(API_URL, {
          method: "POST",
          body: formData
        });

        var rawText = await response.text();
        var data;

        try {
          data = JSON.parse(rawText);
        } catch (err) {
          data = { analysis: rawText };
        }

        if (!response.ok) {
          throw new Error(
            data.error ||
              data.message ||
              data.details ||
              "The backend returned an error."
          );
        }

        var analysis = unwrap(data);
        analysis.selectedPair = analysis.selectedPair || pair.value;
        analysis.selectedTimeframe = analysis.selectedTimeframe || timeframe.value;

        updateDashboard(analysis);
        setStatus("Analysis completed.");
      } catch (error) {
        console.error(error);
        showError(error.message || "Something went wrong while analyzing the chart.");
        setStatus("");
      } finally {
        setLoadingState(false);
      }
    }

    function updateDashboard(data) {
  data = unwrap(data || {});

  // Helpful when checking the browser console after a test.
  console.log("CSA BACKEND RESPONSE:", data);

  var dashboard = data.dashboard || {};
  var dashboardCards = data.dashboardCards || {};

  function firstValue(values, fallback) {
    for (var i = 0; i < values.length; i += 1) {
      var value = values[i];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return fallback;
  }

  function firstArray(values, fallback) {
    for (var i = 0; i < values.length; i += 1) {
      var value = values[i];
      if (Array.isArray(value) && value.length) return value;
    }
    return fallback || [];
  }

  function firstObject(values, fallback) {
    for (var i = 0; i < values.length; i += 1) {
      var value = values[i];
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    }
    return fallback || {};
  }

  var context =
    firstObject([
      data.chartContextCheck,
      data.contextCheck,
      data.chartContext,
      dashboard.chartContextCheck,
      dashboard.contextCheck,
      dashboardCards.chartContextCheck
    ], {});

  var setupQuality =
    firstObject([
      data.setupQuality,
      dashboard.setupQuality,
      dashboardCards.setupQuality
    ], {
      score: firstValue([data.setupQualityScore, data.structureScore], 0),
      label: firstValue([data.setupQualityLabel], "Unavailable"),
      summary: firstValue([data.setupQualitySummary], "Setup quality was not returned.")
    });

  var entryAccuracy =
    firstObject([
      data.entryAccuracy,
      dashboard.entryAccuracy,
      dashboardCards.entryAccuracy
    ], {
      score: firstValue([data.entryAccuracyScore, data.executionScore], 0),
      label: firstValue([data.entryAccuracyLabel], "Unavailable"),
      summary: firstValue([data.entryAccuracySummary], "Entry accuracy was not returned.")
    });

  var riskManagement =
    firstObject([
      data.riskManagement,
      dashboard.riskManagement,
      dashboardCards.riskManagement
    ], {
      score: firstValue([data.riskManagementScore, data.riskScore], 0),
      label: firstValue([data.riskManagementLabel], "Unavailable"),
      summary: firstValue([data.riskManagementSummary], "Risk management was not returned.")
    });

  var strengths =
    firstArray([
      data.strengths,
      data.whatYouDidWell,
      dashboard.strengths,
      dashboardCards.strengths
    ], []);

  var weaknesses =
    firstArray([
      data.weaknesses,
      data.whatCostYouProfit,
      dashboard.weaknesses,
      dashboardCards.weaknesses
    ], []);

  var mistakes =
    firstArray([
      data.aiMistakeDetectionHub,
      data.mistakeDetectionHub,
      data.mistakeHub,
      data.mistakes,
      dashboard.aiMistakeDetectionHub,
      dashboard.mistakes,
      dashboardCards.aiMistakeDetectionHub
    ], []);

  var selectedPair = firstValue([
    context.selectedInstrument,
    data.selectedPair,
    data.pair
  ], pair.value);

  var selectedTimeframe = firstValue([
    context.selectedTimeframe,
    data.selectedTimeframe,
    data.timeframe
  ], timeframe.value);

  var detectedPair = firstValue([
    context.detectedInstrument,
    data.detectedPair,
    data.chartDetection && data.chartDetection.detectedInstrument
  ], "Not clearly visible");

  var detectedTimeframe = firstValue([
    context.detectedTimeframe,
    data.detectedTimeframe,
    data.chartDetection && data.chartDetection.detectedTimeframe
  ], "Not clearly visible");

  var ctxStatus = firstValue([
    context.status,
    data.chartContextStatus,
    data.contextStatus
  ], "Could not verify");

  selectedContext.textContent = selectedPair + " / " + selectedTimeframe;
  detectedContext.textContent = detectedPair + " / " + detectedTimeframe;
  contextStatus.textContent = ctxStatus;
  contextBox.className = "csa-context-box " + getContextClass(ctxStatus);

  var setupScore = normalizeScore(firstValue([setupQuality.score, data.setupQualityScore, data.structureScore], 0));
  var entryScore = normalizeScore(firstValue([entryAccuracy.score, data.entryAccuracyScore, data.executionScore], 0));
  var riskScore = normalizeScore(firstValue([riskManagement.score, data.riskManagementScore, data.riskScore], 0));

  var confidence = normalizeScore(firstValue([
    data.confidence,
    Math.round((setupScore + entryScore + riskScore) / 3)
  ], 0));

  var grade = firstValue([data.grade], getGradeFromScore(confidence));

  gradeText.textContent = grade;
  confidenceText.textContent = confidence + "/100";
  gradeRing.style.background =
    "radial-gradient(circle at center, #08101b 0 52%, transparent 53%), conic-gradient(#00c985 0deg, #00c985 " +
    Math.min(360, confidence * 3.6) +
    "deg, #132033 " +
    Math.min(360, confidence * 3.6) +
    "deg)";

  structureScoreText.textContent = setupScore + "/100";
  executionScoreText.textContent = entryScore + "/100";
  riskScoreText.textContent = riskScore + "/100";

  structureBar.style.width = setupScore + "%";
  executionBar.style.width = entryScore + "%";
  riskBar.style.width = riskScore + "%";

  if (!strengths.length && setupQuality.summary) {
    strengths = [setupQuality.summary];
  }

  if (!weaknesses.length && entryAccuracy.summary) {
    weaknesses = [entryAccuracy.summary, riskManagement.summary].filter(Boolean);
  }

  renderList(
    strengthsList,
    strengths.length ? strengths : ["CSA Coach completed the review, but no strength item was returned."]
  );

  renderList(
    weaknessesList,
    weaknesses.length ? weaknesses : ["No major weakness detected from the available CSA structure data."]
  );

  renderMistakes(mistakes);

  var plan =
    firstValue([
      data.summary,
      data.analysis,
      data.todaysLesson,
      data.riskComment
    ], "Upload a clearer chart so CSA Coach can identify the correct CSA support, resistance, supply, and demand areas.");

  coachPlanText.innerHTML = formatCoachPlan(plan);
} function resetDashboard() {
  selectedContext.textContent = getSelectedContextText();
  detectedContext.textContent = "Waiting for chart";
  contextStatus.textContent = "Not analyzed yet";
  contextBox.className = "csa-context-box warn";
  gradeText.textContent = "--";
  confidenceText.textContent = "0/100";
  gradeRing.style.background = "radial-gradient(circle at center, #08101b 0 52%, transparent 53%), conic-gradient(#00c985 0deg, #00c985 0deg, #132033 0deg)";
  structureScoreText.textContent = "0/100";
  executionScoreText.textContent = "0/100";
  riskScoreText.textContent = "0/100";
  structureBar.style.width = "0%";
  executionBar.style.width = "0%";
  riskBar.style.width = "0%";
  strengthsList.innerHTML = "<li>New chart feedback will appear here after diagnostics.</li>";
  weaknessesList.innerHTML = "<li>No weaknesses shown yet. Run diagnostics on the current chart first.</li>";
  mistakeList.innerHTML = '<div class="csa-mistake-item"><span>•</span><span>No analysis yet for this chart</span><span class="csa-risk-tag">Waiting</span></div>';
  coachPlanText.innerHTML = '<div class="csa-ai-section"><div class="csa-ai-body">Upload, drag, or paste a chart, then click Run AI Diagnostics to get feedback.</div></div>';
}

function formatCoachPlan(text) {
  if (!text || typeof text !== "string") {
    return '<div class="csa-ai-section"><div class="csa-ai-body">No clear analysis returned yet.</div></div>';
  }

  var cleaned = text
    .replace(/\r/g, "")
    .replace(/\*\*/g, "")
    .replace(/#{1,6}\s*/g, "")
    .trim();

  if (!cleaned) {
    return '<div class="csa-ai-section"><div class="csa-ai-body">No clear analysis returned yet.</div></div>';
  }

  var splitMarker = "READ_MORE_DETAILS:";
  var mainText = cleaned;
  var readMoreText = "";

  if (cleaned.indexOf(splitMarker) !== -1) {
    var parts = cleaned.split(splitMarker);
    mainText = parts[0].trim();
    readMoreText = parts.slice(1).join(splitMarker).trim();
  }

  var html = formatCoachPlanSections(mainText);

  if (readMoreText) {
    html +=
      '<details class="csa-read-more-details">' +
        '<summary>Read More Details</summary>' +
        '<div class="csa-read-more-content">' +
          formatCoachPlanSections(readMoreText) +
        '</div>' +
      '</details>';
  }

  return html;
}

function formatCoachPlanSections(text) {
  var cleaned = String(text || "").trim();

  if (!cleaned) {
    return "";
  }

  var lines = cleaned.split("\n").map(function (line) {
    return line.trim();
  });

  var sections = [];
  var current = null;

  lines.forEach(function (line) {
    if (!line) return;

    var headingMatch = line.match(/^-?\s*([A-Za-z][A-Za-z0-9\s/&-]{2,60}):\s*(.*)$/);

    if (headingMatch && !line.startsWith("- ")) {
      if (current) sections.push(current);

      current = {
        heading: headingMatch[1].trim(),
        body: []
      };

      if (headingMatch[2]) {
        current.body.push(headingMatch[2].trim());
      }
    } else {
      if (!current) {
        current = {
          heading: "",
          body: []
        };
      }
      current.body.push(line);
    }
  });

  if (current) sections.push(current);

  if (!sections.length) {
    sections = [{ heading: "", body: [cleaned] }];
  }

  return sections.map(function (section) {
    var bodyHtml = "";
    var openList = false;

    section.body.forEach(function (line) {
      var isBullet = /^[-•*]\s+/.test(line);

      if (isBullet) {
        if (!openList) {
          bodyHtml += "<ul>";
          openList = true;
        }
        bodyHtml += "<li>" + escapeHtml(line.replace(/^[-•*]\s+/, "")) + "</li>";
      } else {
        if (openList) {
          bodyHtml += "</ul>";
          openList = false;
        }
        bodyHtml += "<p>" + escapeHtml(line) + "</p>";
      }
    });

    if (openList) {
      bodyHtml += "</ul>";
    }

    return (
      '<div class="csa-ai-section">' +
        (section.heading ? '<div class="csa-ai-heading">' + escapeHtml(section.heading) + "</div>" : "") +
        '<div class="csa-ai-body">' + bodyHtml + "</div>" +
      "</div>"
    );
  }).join("");
}

function itemToText(item) {
  if (item === null || item === undefined) return "";

  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
    return String(item);
  }

  if (Array.isArray(item)) {
    return item.map(itemToText).filter(Boolean).join(" — ");
  }

  if (typeof item === "object") {
    return (
      item.summary ||
      item.text ||
      item.title ||
      item.detail ||
      item.explanation ||
      item.correction ||
      item.mistakeLabel ||
      JSON.stringify(item)
    );
  }

  return String(item);
} function renderList(container, items) {
  if (!items || !items.length) {
    container.innerHTML = "<li>No specific item returned.</li>";
    return;
  }

  container.innerHTML = items
    .slice(0, 7)
    .map(function (item) {
      return "<li>" + escapeHtml(itemToText(item)) + "</li>";
    })
    .join("");
} function renderMistakes(items) {
  if (!items || !items.length) {
    mistakeList.innerHTML =
      '<div class="csa-mistake-item"><span>▴</span><span>No major mistake detected from the response.</span><span class="csa-risk-tag">Review</span></div>';
    return;
  }

  mistakeList.innerHTML = items
    .slice(0, 7)
    .map(function (item, index) {
      var title = "";
      var detail = "";
      var tag = "Review";

      if (item && typeof item === "object") {
        title = item.title || item.mistakeLabel || item.failedType || "Trading mistake";
        detail = item.detail || item.explanation || item.correction || "";
        tag = item.severity || item.tag || item.risk || "Review";
      } else {
        title = String(item);
      }

      var text = detail ? title + " — " + detail : title;

      return (
        '<div class="csa-mistake-item"><span>▴</span><span>' +
        escapeHtml(text) +
        '</span><span class="csa-risk-tag">' +
        escapeHtml(String(tag)) +
        "</span></div>"
      );
    })
    .join("");
} function fileToBase64(file) { return new Promise(function (resolve, reject) { var reader = new FileReader(); reader.onload = function () { resolve(reader.result); }; reader.onerror = function () { reject(new Error("Could not read the uploaded chart image.")); }; reader.readAsDataURL(file); }); } function unwrap(data) {
  if (!data) return {};

  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch (e) {
      return { summary: data };
    }
  }

  if (typeof data !== "object") {
    return {};
  }

  // Important:
  // Do NOT unwrap data.analysis when it is just a text report.
  // The backend returns useful dashboard fields beside analysis.
  // Unwrapping data.analysis was removing strengths, weaknesses,
  // setupQuality, entryAccuracy, riskManagement, and mistake data.
  var keys = Object.keys(data);

  if (keys.length === 1 && data.analysis && typeof data.analysis === "object") {
    return unwrap(data.analysis);
  }

  if (keys.length === 1 && data.result && typeof data.result === "object") {
    return unwrap(data.result);
  }

  if (keys.length === 1 && data.feedback && typeof data.feedback === "object") {
    return unwrap(data.feedback);
  }

  return data;
} function normalizeScore(value) { var n = numberOrZero(value); if (n <= 10) n = n * 10; return Math.max(0, Math.min(100, Math.round(n))); } function numberOrZero(value) { var n = Number(value); if (Number.isNaN(n)) return 0; return Math.max(0, Math.min(100, Math.round(n))); } function getGradeFromScore(score) { score = numberOrZero(score); if (score >= 90) return "A"; if (score >= 80) return "B+"; if (score >= 70) return "B"; if (score >= 60) return "C"; if (score >= 50) return "D"; return "F"; } function getContextClass(status) { var s = String(status).toLowerCase(); if (s.includes("mismatch")) return "bad"; if (s.includes("match") && !s.includes("mis")) return "good"; return "warn"; } function setLoadingState(isLoading) {
  var overlay = ensureLoadingOverlay();

  analyzeBtn.disabled = isLoading;
  analyzeOverlayBtn.disabled = isLoading;
  resetBtn.disabled = isLoading;
  chartFile.disabled = isLoading;

  analyzeBtn.textContent = isLoading ? "Analyzing chart... please wait" : "Run AI Diagnostics ⊙";
  analyzeOverlayBtn.textContent = isLoading ? "Analyzing chart... please wait" : "Run AI Diagnostics ⊙";

  if (chartCard) {
    if (isLoading) chartCard.classList.add("csa-is-analyzing");
    else chartCard.classList.remove("csa-is-analyzing");
  }

  if (overlay) overlay.style.display = isLoading ? "flex" : "none";

  if (statusBox) {
    if (isLoading) statusBox.classList.add("csa-status-running");
    else statusBox.classList.remove("csa-status-running");
  }

  if (isLoading) {
    setStatus("AI diagnostics is running. Please wait while the chart is being reviewed...");
  }
}

function showError(message) { errorBox.textContent = message; errorBox.style.display = "block"; } function hideError() { errorBox.textContent = ""; errorBox.style.display = "none"; } function setStatus(message) { if (!message) { statusBox.style.display = "none"; statusBox.textContent = ""; return; } statusBox.textContent = message; statusBox.style.display = "block"; } function escapeHtml(value) { return String(value) .replace(/&/g, "&amp;") .replace(/</g, "&lt;") .replace(/>/g, "&gt;") .replace(/"/g, "&quot;") .replace(/'/g, "&#039;"); } })(); </script> </div>
