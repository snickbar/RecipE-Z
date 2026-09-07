// One-time migration: takes an export of the current recipe data (the exact same getAppData()
// shape the frontend already consumes) and writes it into one Firebase account's Firestore data,
// in the users/{uid}/recipes/* + users/{uid}/meta/appData shape the new app expects.
//
// Step 1 — export your current data (no new server endpoint needed, so nothing about the old app
// has to change to run this): open the OLD app in a browser, open DevTools > Console, and run:
//   copy(JSON.stringify(await new Promise((res, rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej).getAppData())))
// That copies the JSON to your clipboard — paste it into a new file at scripts/app-data-export.json.
// (Deliberately not fetched over HTTP from a script endpoint: getAppData() has no auth check today,
// since it's always been a single-family app, so adding a public URL for it would leak every recipe
// to anyone who found the link. Going through google.script.run from inside the already-loaded page,
// same as the app itself does, avoids creating that exposure.)
//
// Step 2 — run this script:
//   node scripts/migrate-sheet-to-firestore.js --uid <your-firebase-uid> --key <path-to-service-account.json>
//
// Where to get each argument:
//   --uid  Sign up/sign in once on https://recipe-z-aaba1.web.app, then Firebase Console ->
//          Authentication -> Users -> copy the "User UID" column for your account.
//   --key  Firebase Console -> Project Settings (gear icon) -> Service Accounts tab ->
//          "Generate new private key" -> saves a .json file. Keep this file OUT of git (it's a
//          real credential) - pass its path here, don't commit it or paste its contents anywhere.
//
// Safe to re-run: recipes are written with set(..., {merge:true}) keyed by their existing recipe
// id, so running this twice just re-writes the same documents rather than duplicating them.

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = { file: 'scripts/app-data-export.json' };
  process.argv.slice(2).forEach((arg, i, arr) => {
    if (arg === '--uid') args.uid = arr[i + 1];
    if (arg === '--key') args.key = arr[i + 1];
    if (arg === '--file') args.file = arr[i + 1];
  });
  return args;
}

async function main() {
  const { uid, key, file } = parseArgs();
  if (!uid || !key) {
    console.error('Usage: node migrate-sheet-to-firestore.js --uid <firebase-uid> --key <path-to-service-account.json> [--file <exported-app-data.json>]');
    process.exit(1);
  }

  const exportPath = path.resolve(file);
  if (!fs.existsSync(exportPath)) {
    console.error('\nCould not find ' + exportPath + '.');
    console.error('First export your current data: open the OLD app in a browser, DevTools > Console, run:');
    console.error('  copy(JSON.stringify(await new Promise((res, rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej).getAppData())))');
    console.error('Then paste the copied JSON into ' + exportPath + ' and re-run this script.');
    process.exit(1);
  }

  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(key))) });
  const db = admin.firestore();

  const data = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  if (!data || !Array.isArray(data.recipes)) {
    console.error('scripts/app-data-export.json does not look like a getAppData() export (no recipes array).');
    process.exit(1);
  }

  console.log('Found', data.recipes.length, 'recipes,', (data.categories || []).length, 'categories,',
    (data.ingredients || []).length, 'master ingredients,', (data.units || []).length, 'units.');

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    await userRef.set({ createdAt: admin.firestore.FieldValue.serverTimestamp() });
  }

  await db.doc(`users/${uid}/meta/appData`).set({
    categories: data.categories || [],
    ingredients: data.ingredients || [],
    units: data.units || []
  }, { merge: true });
  console.log('Wrote categories/ingredients/units to users/' + uid + '/meta/appData');

  let written = 0;
  const batchSize = 400;
  let batch = db.batch();
  let inBatch = 0;
  for (const recipe of data.recipes) {
    const ref = db.doc(`users/${uid}/recipes/${recipe.id}`);
    batch.set(ref, Object.assign({}, recipe, { ownerId: uid, favorite: !!recipe.favorite }), { merge: true });
    inBatch++;
    written++;
    if (inBatch >= batchSize) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();

  console.log('Wrote', written, 'recipes to users/' + uid + '/recipes/*');
  console.log('\nDone. Sign in to https://recipe-z-aaba1.web.app with that account and your recipes should all be there.');
  console.log('Note: photo URLs were copied as-is (still pointing at Drive) - they will keep working, just');
  console.log('not moved to Firebase Storage. Re-saving a recipe from the new app will migrate its photos then.');
}

main().catch((e) => { console.error(e); process.exit(1); });
