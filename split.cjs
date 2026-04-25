const fs = require('fs');

const html = fs.readFileSync('MedOs.html', 'utf8');

const styleRegex = /<style>([\s\S]*?)<\/style>/i;
const scriptRegex = /<script>([\s\S]*?)<\/script>/i;

const styleMatch = html.match(styleRegex);
const scriptMatch = html.match(scriptRegex);

if (styleMatch) {
  fs.mkdirSync('css', { recursive: true });
  fs.writeFileSync('css/styles.css', styleMatch[1].trim());
}

if (scriptMatch) {
  fs.mkdirSync('js', { recursive: true });
  fs.writeFileSync('js/app.js', scriptMatch[1].trim());
}

let newHtml = html;
if (styleMatch) {
  newHtml = newHtml.replace(styleRegex, '<link rel="stylesheet" href="css/styles.css">');
}
if (scriptMatch) {
  const scripts = `
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="js/app.js"></script>
`;
  newHtml = newHtml.replace(scriptRegex, scripts.trim());
}

fs.writeFileSync('index.html', newHtml);
console.log('Split successful');
