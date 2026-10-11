Bindarr self-hosted server (windows-x64).

Run: double-click bindarr-server.exe
Then open http://localhost:3001
Config: copy app/backend/.env.example to app/backend/.env and edit.
Code-free card-image scan matching needs the whole-game indexes in
app/backend/data (built from Admin -> Global Scan Indexes); without
them, set-scoped scanning still works and code-free returns nothing.
