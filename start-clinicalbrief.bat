@echo off
cls
echo =====================================================================
echo                CLINICALBRIEF - LOCAL DEVELOPMENT
echo =====================================================================
echo.
echo  Backend (Python 3.12):
echo    cd clinicalbrief-backend
echo    py -3.12 -m pip install -r requirements-dev.txt
echo    py -3.12 -m app.cli import synthea ..\data\raw\synthea-fhir
echo    set CLINICALBRIEF_ALLOW_REMOTE_DB=1   (only when DATABASE_URL points at Supabase)
echo    set EXPOSE_API_DOCS=true   (interactive API docs at /docs; off by default and in production)
echo    py -3.12 -m uvicorn app.main:app --reload --no-access-log
echo.
echo  Frontend:
echo    cd clinicalbrief-frontend
echo    npm install
echo    npm run dev
echo.
echo  Sign-in requires a Supabase project: see clinicalbrief-backend\.env.example
echo  and clinicalbrief-frontend\.env.example.
echo =====================================================================
pause
