CSA COACH BACKEND - RENDER SETUP GUIDE

WHAT THIS IS
This folder contains the backend for CSA Coach. It keeps your OpenAI API key private and allows your GoHighLevel HTML page to send chart screenshots for AI analysis.

FILES INCLUDED
1. package.json
2. server.js
3. README-SETUP.txt

STEP 1 - UPLOAD TO GITHUB
1. Go to github.com and sign in.
2. Click the + icon at the top right.
3. Click New repository.
4. Repository name: csa-coach-backend
5. Choose Public or Private. Private is fine.
6. Click Create repository.
7. Upload these files:
   - package.json
   - server.js
   - README-SETUP.txt
8. Commit the files.

STEP 2 - CREATE RENDER WEB SERVICE
1. Go to render.com and sign in.
2. Click New +.
3. Click Web Service.
4. Connect your GitHub account if needed.
5. Select your csa-coach-backend repository.
6. Use these settings:
   Name: csa-coach-backend
   Environment: Node
   Build Command: npm install
   Start Command: npm start
7. Click Create Web Service.

STEP 3 - ADD OPENAI API KEY
1. Open your new Render service.
2. Go to Environment.
3. Add this environment variable:
   Key: OPENAI_API_KEY
   Value: your OpenAI API key
4. Save changes.
5. Redeploy the service.

IMPORTANT:
Do not put the OpenAI API key in GoHighLevel HTML.
Do not commit your OpenAI API key to GitHub.

STEP 4 - TEST BACKEND
When deployment is done, Render gives you a URL like:
https://csa-coach-backend.onrender.com

Open that URL. You should see:
{
  "status": "ok",
  "service": "CSA Coach backend is running"
}

Your AI endpoint will be:
https://csa-coach-backend.onrender.com/analyze-chart

STEP 5 - CONNECT TO GOHIGHLEVEL HTML
In your CSA Coach HTML, find:
const CSA_COACH_API_ENDPOINT = "https://YOUR-BACKEND-ENDPOINT.com/analyze-chart";

Replace it with your Render endpoint:
const CSA_COACH_API_ENDPOINT = "https://YOUR-RENDER-SERVICE.onrender.com/analyze-chart";

STEP 6 - TEST IN GOHIGHLEVEL
1. Paste the updated HTML into GoHighLevel.
2. Upload a chart screenshot.
3. Choose Pre-trade or Post-trade.
4. Click Coach My Trade.
5. You should receive a CSA Coach report.

BEFORE PUBLIC LAUNCH
In server.js, change:
app.use(cors({ origin: "*" }));

to your real domain, for example:
app.use(cors({ origin: "https://training.csaforex.com" }));

This prevents other websites from calling your backend.
