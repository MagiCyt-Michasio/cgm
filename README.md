# xDrip CGM — Android / Termux

Wersja uruchamiana w całości lokalnie na telefonie z Androidem. Frontend zachowuje interfejs z repozytorium `xdrip-backup`, a backend pobiera odczyty i terapie z API Nightscout. MongoDB nie jest wymagane.

## Wymagania
- Android 7 lub nowszy
- Termux z F-Droid lub oficjalnego GitHub: https://github.com/termux/termux-app
- Dostępny adres serwera Nightscout

## Instalacja w Termux

```bash
pkg update -y && pkg upgrade -y
pkg install -y git nodejs-lts
git clone https://github.com/MagiCyt-Michasio/cgm.git
cd cgm
npm install
cp .env.example .env
nano .env
```

Ustaw w `.env`:
- `NIGHTSCOUT_URL` — pełny adres Nightscout, np. `https://moja-domena.example`
- `API_SECRET` — API Secret Nightscout, jeśli jest wymagany (backend wysyła SHA-1 w nagłówku `api-secret`).

Następnie:

```bash
npm run check
npm start
```

Otwórz w przeglądarce telefonu: http://127.0.0.1:3050/dane

## Dane i bezpieczeństwo
- Odczyty CGM i terapie są pobierane z API Nightscout.
- Ręcznie dodane wpisy są przechowywane lokalnie w `data/treatments.json`.
- Usuwanie dotyczy wyłącznie wpisów lokalnych. Wpisów pobranych z Nightscout aplikacja nie usuwa.
- Nie udostępniaj portu na zewnątrz. Serwer nasłuchuje tylko na `127.0.0.1`.
- Kopia lokalnych wpisów: `cp data/treatments.json data/treatments.backup.json`.

## Ważne
To nie jest serwer Nightscout ani kopia bazy MongoDB. Telefon łączy się z istniejącym Nightscout przez HTTP API. Gdy telefon nie ma internetu albo Nightscout jest niedostępny, nie pojawią się nowe dane.
