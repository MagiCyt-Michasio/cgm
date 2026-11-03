#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Utworzono .env. Uzupełnij NIGHTSCOUT_URL i API_SECRET, potem uruchom ponownie ./start.sh"
  exit 0
fi
npm start
