#!/usr/bin/env bash
PROJECT_FOLDER=/var/www/quizmcp
cd ${PROJECT_FOLDER}
echo "Starting Deployment"
nvm use 20
if command -v pm2 ; then
  echo "Stopping Node Processing Manager PM2"
  pm2 stop ./src/server.js --name QuizFactorMCP
fi

echo "Using node version $(node -v)"
echo "Installing Node modules for PaymentSystem"
npm install

if command -v pm2 ; then
  echo "Restarting Node Processing Manager PM2"
  pm2 start ./src/server.js --name QuizFactorMCP
fi
echo ".........ALL DONE DEPLOY COMPLETE........"
