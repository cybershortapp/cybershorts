// Adds phone alerts to app.json without touching anything else in it (your Expo project ID stays).
// Run once from the app folder:  node scripts/setup-notifications.js
const fs = require('fs');
const file = 'app.json';
const app = JSON.parse(fs.readFileSync(file, 'utf8'));
const e = app.expo;
e.android = e.android || {};
e.android.googleServicesFile = './google-services.json';
e.plugins = e.plugins || [];
const has = e.plugins.some((p) => (Array.isArray(p) ? p[0] : p) === 'expo-notifications');
if (!has) e.plugins.push(['expo-notifications', { icon: './assets/notification-icon.png', color: '#2563F5', defaultChannel: 'news' }]);
fs.writeFileSync(file, JSON.stringify(app, null, 2) + '\n');
console.log(has ? 'Phone alerts were already set up in app.json.' : 'Done: phone alerts added to app.json.');
console.log(fs.existsSync('google-services.json') ? 'google-services.json found.' : 'Next: put google-services.json from Firebase in this app folder.');
