# Pray
Book Your Calendar for Prayer

A static web page that turns daily prayer times into a calendar file (.ics) you can import into Outlook. Each prayer becomes a Busy event with a reminder, so your calendar is blocked for prayer and colleagues see you as unavailable.

## Use it

1. Choose where you will be: search for a city, click the map, use your current location, or type latitude, longitude and time zone.
2. Pick a calculation method, the Asr setting and the dates you will be there (for example, the days of a trip).
3. Choose which prayers to block, how long to block for, and the reminder.
4. Download the .ics file and import it into Outlook:
   - **Outlook on the web / new Outlook:** Calendar > Add calendar > Upload from file.
   - **Classic Outlook for Windows:** File > Open & Export > Import/Export > Import an iCalendar (.ics) or vCalendar file > Import.
   - **Outlook for Mac:** File > Import, or drag the file onto the calendar.

Prayer times are computed in the browser with [adhan-js](https://github.com/batoulapps/adhan-js) (vendored in `vendor/`). City search and the time zone for a map click use the free [Open-Meteo](https://open-meteo.com/) APIs, the place name for a map click comes from OpenStreetMap's Nominatim, and the map is [Leaflet](https://leafletjs.com/) with OpenStreetMap tiles. If those services are unreachable, you can still type coordinates and a time zone.

## Run locally

No build step. Open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8080   # then open http://localhost:8080
```

It can also be hosted as-is on GitHub Pages.

## Tests

```sh
npm install
npm test
```

The tests check the prayer schedule, event building, and that the generated .ics parses as valid iCalendar (CRLF line endings, folded lines, unique UIDs, Busy status, reminders).
