# CGM Unified Monitor 3

Scalona wersja oparta na dwóch źródłach:
- `xdrip-backup`: oryginalny interfejs xDrip Monitor i jego funkcje analityczne.
- `xdrip-monitor-ns`: backend obsługujący bezpośrednio istniejącą bazę MongoDB Nightscout.

Repozytorium Androidowego/proot `cgm` nie jest źródłem kodu tej wersji.

## Co zawiera

- Oryginalny, rozbudowany interfejs z `xdrip-monitor-ns/public/index.html`.
- Poprawkę usuwania ręcznych wpisów po MongoDB ObjectId.
- Backend Express z endpointami:
  - `GET /health`
  - `GET /dane`
  - `GET /dane/api/data?hours=72`
  - `GET /dane/api/treemap`
  - `POST /dane/api/treatments`
  - `DELETE /dane/api/treatments/:id`
- Deduplikację rozpoznanej pary LibreView CSV / Bolus (Odzyskany) tylko w odpowiedzi API.
- Usuwanie wyłącznie ręcznych wpisów oznaczonych przez tę aplikację.

## Baza danych — WAŻNE

Aplikacja nie tworzy, nie czyści, nie migruje i nie usuwa baz ani dokumentów.
Domyślna nazwa bazy to `nightscout`, zgodnie z repozytorium `xdrip-monitor-ns`.
Jeśli rzeczywista baza Nightscout na serwerze ma inną nazwę, ustaw właściwą wartość `MONGODB_DB` w pliku `.env`.
Nie zakładaj automatycznie, że baza nazywa się `cgm` albo `dane`.

## Instalacja

```bash
npm install
cp .env.example .env
nano .env
npm test
npm start
```

Panel: `http://127.0.0.1:3050/dane`
Kontrola: `http://127.0.0.1:3050/health`

Domyślnie serwer nasłuchuje tylko na loopback. Do publicznego dostępu użyj Nginx/Cloudflare Tunnel i zabezpiecz domenę Cloudflare Access lub innym uwierzytelnianiem. Nie wystawiaj portu aplikacji bezpośrednio do Internetu.

## Dane LibreView CSV

Importer CSV nie został automatycznie przeniesiony ze starego skryptu `migrate.js`: tamten skrypt aktualizuje dokumenty w kolekcji `entries` na podstawie konkretnych polskich nazw kolumn i nie jest bezpiecznym, uniwersalnym importerem. Importer zostanie dodany po sprawdzeniu rzeczywistego, połączonego pliku CSV i ustaleniu mapowania pól.

## Źródła

- https://github.com/MagiCyt-Michasio/xdrip-backup
- https://github.com/MagiCyt-Michasio/xdrip-monitor-ns
