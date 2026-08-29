const DEFAULT_CATEGORIES = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snacks', 'Appetizers', 'Side Dish', 'Beverages'];
const DEFAULT_INGREDIENTS = [
  { name: 'Butter', category: 'basic', unit: 'oz' },
  { name: 'Tomatoes', category: 'basic', unit: 'Items' },
  { name: 'Beef Chuck', category: 'basic', unit: 'lb' },
  { name: 'Carrots', category: 'basic', unit: 'Items' },
  { name: 'Olive Oil', category: 'basic', unit: 'tbsp' },
  { name: 'Garlic', category: 'basic', unit: 'Items' },
  { name: 'Onions', category: 'basic', unit: 'Items' },
  { name: 'Salt', category: 'basic', unit: 'tsp' },
  { name: 'Black Pepper', category: 'basic', unit: 'tsp' },
  { name: 'Flour', category: 'basic', unit: 'cups' }
];

const INGREDIENT_CATEGORIES = ['basic', 'probably buy', 'must check'];
const DEFAULT_UNITS = ['oz', 'tsp', 'tbsp', 'g', 'cups', 'lb', 'Items', 'jars', 'cans'];

// Maps spelled-out/plural unit variants already in the sheet to the app's fixed unit set
const UNIT_SYNONYMS = {
  'tablespoon': 'tbsp', 'tablespoons': 'tbsp', 'tbsp': 'tbsp',
  'teaspoon': 'tsp', 'teaspoons': 'tsp', 'tsp': 'tsp',
  'ounce': 'oz', 'ounces': 'oz', 'oz': 'oz',
  'pound': 'lb', 'pounds': 'lb', 'lb': 'lb', 'lbs': 'lb',
  'gram': 'g', 'grams': 'g', 'g': 'g',
  'cup': 'cups', 'cups': 'cups',
  'item': 'Items', 'items': 'Items',
  'jar': 'jars', 'jars': 'jars',
  'can': 'cans', 'cans': 'cans'
};

function normalizeUnit(raw) {
  const key = (raw || '').toString().trim().toLowerCase();
  return UNIT_SYNONYMS[key] || raw || '';
}

function normalizeIngredientCategory(raw) {
  const key = (raw || '').toString().trim().toLowerCase();
  return INGREDIENT_CATEGORIES.includes(key) ? key : '';
}

const APP_EXEC_URL = 'https://script.google.com/macros/s/AKfycbxSJjh8sMtIJsQYT3J0AnRFIZnHjX1JTBbGGyAOcnV7Ed94tFLgztIpGA6nOETzcyy9fw/exec';

// Serves the app's HTML when visiting the web app URL. Also doubles as the endpoint for the PWA
// web manifest (?manifest=1) and the one-time app-icon upload (?setupIcons=1), since Apps Script
// web apps only get this one entry point — there's no separate static-file routing available.
function doGet(e) {
  const param = e && e.parameter ? e.parameter : {};

  if (param.manifest === '1') {
    return ContentService.createTextOutput(JSON.stringify(getWebManifest()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (param.setupIcons === '1') {
    return ContentService.createTextOutput(JSON.stringify(setupAppIcons()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('RecipE-Z')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getWebManifest() {
  const icons = getAppIconUrls();
  return {
    name: 'RecipE-Z',
    short_name: 'RecipE-Z',
    description: 'Your family recipes, all made E-Z',
    start_url: APP_EXEC_URL,
    scope: APP_EXEC_URL,
    display: 'standalone',
    background_color: '#f6efdd',
    theme_color: '#4a280e',
    icons: [
      { src: icons['192'], sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icons['512'], sizes: '512x512', type: 'image/png', purpose: 'any' }
    ]
  };
}

// Returns the cached Drive URLs for the app icon set, uploading them to Drive on first call only.
// drive.google.com/thumbnail?id= 404s until Drive has generated a thumbnail for a brand-new file
// (can lag well behind upload), so icons use uc?export=view instead, which serves immediately —
// unlike recipe photos, these are small enough (well under Drive's virus-scan-interstitial
// threshold) that uc?export=view's usual unreliability for big files doesn't apply here.
function getAppIconUrls() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('APP_ICON_URLS');
  if (cached) {
    const urls = JSON.parse(cached);
    // One-time fix for URLs cached before the format above was settled on.
    let changed = false;
    Object.keys(urls).forEach(size => {
      const match = urls[size].match(/id=([^&]+)/);
      if (match && urls[size].indexOf('uc?export=view') === -1) {
        urls[size] = 'https://drive.google.com/uc?export=view&id=' + match[1];
        changed = true;
      }
    });
    if (changed) props.setProperty('APP_ICON_URLS', JSON.stringify(urls));
    return urls;
  }
  return setupAppIcons().urls;
}

// One-time upload of the app icon (Dutch Oven & Steam design) to Drive at each size the PWA/home
// screen setup needs, caching the resulting URLs so repeat calls never re-upload. Safe to call
// more than once — only uploads on the very first call.
function setupAppIcons() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('APP_ICON_URLS');
  if (cached) return { success: true, urls: getAppIconUrls(), cached: true };

  const iconData = {
    '512': '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',
    '192': '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'
  };

  const folder = getOrCreateRecipeImagesFolder();
  const urls = {};
  Object.keys(iconData).forEach(size => {
    const bytes = Utilities.base64Decode(iconData[size]);
    const blob = Utilities.newBlob(bytes, 'image/png', 'app-icon-' + size + '.png');
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    urls[size] = 'https://drive.google.com/uc?export=view&id=' + file.getId();
  });

  props.setProperty('APP_ICON_URLS', JSON.stringify(urls));
  return { success: true, urls: urls, cached: false };
}

// Fetch everything the app needs on load: recipes (with steps + ingredients), categories, and the master ingredients list
function getAppData() {
  return {
    recipes: getRecipes(),
    categories: readSheetList('Categories', DEFAULT_CATEGORIES),
    ingredients: readIngredientsList(),
    units: readSheetList('Units', DEFAULT_UNITS)
  };
}

// Parses the "Ingredients Used" cell for one step. New rows store JSON ([{name,qty,unit}, ...])
// so per-step amounts round-trip; older rows are a plain comma-separated list of names with no
// amounts, which is parsed into the same shape with blank qty/unit.
function parseStepIngredients(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    // not JSON — fall through to legacy parsing
  }

  return raw.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, qty: '', unit: '' }));
}

// Fetch all recipes from RecipeList, joined with their steps and ingredients
function getRecipes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const listData = ss.getSheetByName("RecipeList").getDataRange().getValues();
  listData.shift(); // remove headers

  const stepsData = ss.getSheetByName("RecipeSteps").getDataRange().getValues();
  stepsData.shift();

  const ingredientsSheet = ss.getSheetByName("RecipeIngredients");
  const ingredientsData = ingredientsSheet ? ingredientsSheet.getDataRange().getValues() : [];
  if (ingredientsData.length > 0) ingredientsData.shift();

  const notesSheet = ss.getSheetByName("RecipeNotes");
  const notesData = notesSheet ? notesSheet.getDataRange().getValues() : [];
  if (notesData.length > 0) notesData.shift();

  const stepsByRecipe = {};
  stepsData.forEach(row => {
    const recipeId = row[0];
    const stepIngredients = parseStepIngredients(row[3]);
    if (!stepsByRecipe[recipeId]) stepsByRecipe[recipeId] = [];
    stepsByRecipe[recipeId].push({
      text: row[2],
      ingredients: stepIngredients,
      picture: row[4] || ''
    });
  });

  const notesByRecipe = {};
  notesData.forEach(row => {
    const recipeId = row[0];
    if (!notesByRecipe[recipeId]) notesByRecipe[recipeId] = [];
    notesByRecipe[recipeId].push({ text: row[2], picture: row[3] || '' });
  });

  const ingredientsByRecipe = {};
  ingredientsData.forEach(row => {
    const recipeId = row[0];
    if (!ingredientsByRecipe[recipeId]) ingredientsByRecipe[recipeId] = [];
    ingredientsByRecipe[recipeId].push({ name: row[2], qty: row[3], unit: row[4], note: row[5] || '' });
  });

  return listData.map(row => {
    const id = String(row[0]); // Sheets stores numeric-looking IDs as numbers; normalize so ID comparisons in the frontend work
    return {
      id: id,
      title: row[1],
      mainPicture: row[2],
      category: row[3],
      equipment: row[4],
      prepTime: row[5],
      servings: row[6],
      createdAt: Number(row[7]) || 0,
      ingredients: ingredientsByRecipe[id] || [],
      steps: stepsByRecipe[id] || [],
      notes: notesByRecipe[id] || []
    };
  });
}

// Runs fn() while holding the script lock, so two overlapping saves can never interleave their
// sheet writes (this was the root cause of duplicated/jumbled RecipeSteps rows). Waits up to 10s
// for the lock before giving up, so a stuck caller fails loudly instead of corrupting data.
function withScriptLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Finds (or creates once) the Drive folder that holds uploaded recipe photos, remembering its ID
// in Script Properties so repeat lookups don't need broader Drive search permissions.
function getOrCreateRecipeImagesFolder() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty('IMAGES_FOLDER_ID');
  if (existingId) {
    try {
      return DriveApp.getFolderById(existingId);
    } catch (e) {
      // folder was deleted/moved out from under us; fall through and make a new one
    }
  }
  const folder = DriveApp.createFolder('RecipE-Z Images');
  props.setProperty('IMAGES_FOLDER_ID', folder.getId());
  return folder;
}

// Uploaded photos arrive as base64 data URIs, which blow past Sheets' 50,000-char cell limit for
// anything but a tiny thumbnail. If the value is a data URI, save it to Drive as a real file and
// return a hotlinkable URL instead; anything else (a pasted URL, or empty) passes through as-is.
function saveImageIfDataUri(dataUri, filenamePrefix) {
  if (!dataUri || typeof dataUri !== 'string' || dataUri.indexOf('data:image') !== 0) {
    return dataUri || '';
  }
  const match = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!match) return dataUri;

  const mimeType = match[1];
  const ext = mimeType.split('/')[1].split('+')[0];
  const bytes = Utilities.base64Decode(match[2]);
  const blob = Utilities.newBlob(bytes, mimeType, filenamePrefix + '_' + new Date().getTime() + '.' + ext);

  const folder = getOrCreateRecipeImagesFolder();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600';
}

// One-time fix for recipes saved before the image URL format changed: drive.google.com/uc?export=view
// links intermittently fail to render as <img> (Google serves an interstitial instead of the image),
// while drive.google.com/thumbnail links render reliably. Rewrites any old-format links in place across
// RecipeList, RecipeSteps, and RecipeNotes. Safe to run more than once — it's a no-op after the first run.
function migrateDriveImageUrls() {
  return withScriptLock(() => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const oldPrefix = 'https://drive.google.com/uc?export=view&id=';
    let updatedCount = 0;

    function fixColumn(sheetName, colIndex) {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) return;
      const range = sheet.getDataRange();
      const values = range.getValues();
      let changed = false;
      for (let i = 1; i < values.length; i++) {
        const cell = values[i][colIndex];
        if (typeof cell === 'string' && cell.indexOf(oldPrefix) === 0) {
          const fileId = cell.substring(oldPrefix.length);
          values[i][colIndex] = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1600';
          changed = true;
          updatedCount++;
        }
      }
      if (changed) range.setValues(values);
    }

    fixColumn('RecipeList', 2);   // Main Picture
    fixColumn('RecipeSteps', 4);  // Step Picture
    fixColumn('RecipeNotes', 3);  // Note Picture

    return { success: true, updatedCount: updatedCount };
  });
}

// Save (or update) one recipe across RecipeList, RecipeSteps, and RecipeIngredients
function saveNewRecipe(recipeData) {
  return withScriptLock(() => {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const listSheet = ss.getSheetByName("RecipeList");
  const stepsSheet = ss.getSheetByName("RecipeSteps");
  const ingSheet = ss.getSheetByName("RecipeIngredients") || ss.insertSheet("RecipeIngredients");
  const notesSheet = ss.getSheetByName("RecipeNotes") || ss.insertSheet("RecipeNotes");

  // Sheets created before per-ingredient notes existed only have 5 columns — add the header once,
  // in place, without touching any existing rows.
  if (ingSheet.getRange(1, 6).getValue() !== "Note") {
    ingSheet.getRange(1, 6).setValue("Note");
  }

  const recipeId = recipeData.id || ("rec_" + new Date().getTime());

  upsertRowByRecipeId(listSheet, recipeId, [
    recipeId,
    recipeData.title,
    saveImageIfDataUri(recipeData.mainPicture, recipeId + '_main'),
    recipeData.category || "General",
    recipeData.equipment || "",
    recipeData.prepTime || "",
    recipeData.servings || "",
    recipeData.createdAt || Date.now()
  ]);

  clearRowsByRecipeId(stepsSheet, recipeId);
  if (recipeData.steps && recipeData.steps.length > 0) {
    const stepRows = [];
    recipeData.steps.forEach(step => {
      const instructionText = typeof step === 'string' ? step : (step.text || "");
      if (!instructionText.trim()) return; // skip empty steps to avoid junk rows

      const ingText = (Array.isArray(step.ingredients) && step.ingredients.length > 0)
        ? JSON.stringify(step.ingredients)
        : "";

      const stepPicture = saveImageIfDataUri(step.picture, recipeId + '_step' + (stepRows.length + 1));
      stepRows.push([recipeId, stepRows.length + 1, instructionText, ingText, stepPicture]);
    });
    if (stepRows.length > 0) {
      stepsSheet.getRange(stepsSheet.getLastRow() + 1, 1, stepRows.length, 5).setValues(stepRows);
    }
  }

  clearRowsByRecipeId(ingSheet, recipeId);
  if (recipeData.ingredients && recipeData.ingredients.length > 0) {
    const ingRows = recipeData.ingredients.map(ing => [recipeId, recipeData.title, ing.name || "", ing.qty || 0, ing.unit || "", ing.note || ""]);
    ingSheet.getRange(ingSheet.getLastRow() + 1, 1, ingRows.length, 6).setValues(ingRows);
  }

  clearRowsByRecipeId(notesSheet, recipeId);
  if (recipeData.notes && recipeData.notes.length > 0) {
    const noteRows = [];
    recipeData.notes.forEach(note => {
      const noteText = typeof note === 'string' ? note : (note.text || "");
      if (!noteText.trim()) return; // skip empty notes to avoid junk rows
      const notePicture = saveImageIfDataUri(note.picture, recipeId + '_note' + (noteRows.length + 1));
      noteRows.push([recipeId, noteRows.length + 1, noteText, notePicture]);
    });
    if (noteRows.length > 0) {
      notesSheet.getRange(notesSheet.getLastRow() + 1, 1, noteRows.length, 4).setValues(noteRows);
    }
  }

  return { success: true, recipeId: recipeId };
  });
}

// Deletes a recipe (and its steps/ingredients) from the spreadsheet by ID
function deleteRecipe(recipeId) {
  return withScriptLock(() => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    clearRowsByRecipeId(ss.getSheetByName("RecipeList"), recipeId);
    clearRowsByRecipeId(ss.getSheetByName("RecipeSteps"), recipeId);
    const ingSheet = ss.getSheetByName("RecipeIngredients");
    if (ingSheet) clearRowsByRecipeId(ingSheet, recipeId);
    const notesSheet = ss.getSheetByName("RecipeNotes");
    if (notesSheet) clearRowsByRecipeId(notesSheet, recipeId);
    return { success: true };
  });
}

// Saves just the recipe categories list (used when a new category is added inline)
function saveCategories(categories) {
  return withScriptLock(() => {
    writeSheetList('Categories', categories);
    return { success: true };
  });
}

// Saves just the measurement units list (used when a unit is added, renamed, or deleted)
function saveUnits(units) {
  return withScriptLock(() => {
    writeSheetList('Units', units);
    return { success: true };
  });
}

// Sends pasted, unstructured recipe text to Claude and gets back structured fields matching this
// app's own recipe shape. The API key lives in Script Properties (Project Settings), never in this
// file, since Code.js is committed to a public-ish GitHub repo.
function smartImportRecipe(rawText) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return { success: false, error: 'No Anthropic API key configured. Add ANTHROPIC_API_KEY under Project Settings > Script Properties.' };
  }
  if (!rawText || !rawText.trim()) {
    return { success: false, error: 'No recipe text provided.' };
  }

  const ingredientSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      qty: { type: 'number' },
      unit: { type: 'string' }
    },
    required: ['name', 'qty', 'unit']
  };

  const tool = {
    name: 'record_parsed_recipe',
    description: 'Records a recipe parsed from unstructured text into structured fields.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        category: { type: 'string', description: 'e.g. Breakfast, Lunch, Dinner, Dessert, Snacks, Appetizers, Side Dish, Beverages' },
        equipment: { type: 'string', description: 'Comma-separated equipment needed, if mentioned' },
        prepTime: { type: 'string' },
        servings: { type: 'string' },
        ingredients: { type: 'array', items: ingredientSchema },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              ingredients: { type: 'array', items: ingredientSchema, description: 'Which of the recipe ingredients (with the amount used) this specific step involves' }
            },
            required: ['text', 'ingredients']
          }
        },
        notes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Any extra tips, substitutions, storage/make-ahead instructions, or asides mentioned in the ' +
            'text that are not part of the main step-by-step instructions — e.g. "can be frozen for up to 3 months" ' +
            'or "tastes best the next day."'
        }
      },
      required: ['title', 'ingredients', 'steps']
    }
  };

  const payload = {
    model: 'claude-opus-5',
    max_tokens: 4096,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'record_parsed_recipe' },
    messages: [{
      role: 'user',
      content: 'Parse the following recipe into structured data. Prefer standard unit abbreviations ' +
        '(oz, tsp, tbsp, g, cups, lb, Items, jars, cans) where the text is ambiguous or uses a full word. ' +
        'If a field is not mentioned in the text, omit it or leave it blank rather than guessing. ' +
        'Split the instructions into individual steps, and for each step list only the ingredients ' +
        'and amounts actually used in that step. Pull out any tips, substitutions, or notes that aren\'t ' +
        'part of the main steps into the notes field, each as its own separate note.\n\nRecipe text:\n\n' + rawText
    }]
  };

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  let result;
  try {
    result = JSON.parse(response.getContentText());
  } catch (e) {
    return { success: false, error: 'Unexpected response from Claude API.' };
  }

  if (result.error) {
    return { success: false, error: result.error.message || 'Claude API error.' };
  }

  const toolUseBlock = (result.content || []).find(block => block.type === 'tool_use');
  if (!toolUseBlock) {
    return { success: false, error: 'Could not parse that recipe — try pasting more of it, or check the formatting.' };
  }

  return { success: true, recipe: toolUseBlock.input };
}

// Sends the master ingredients list to Claude and asks it to find groups of names that are really
// the same real-world ingredient — misspellings, singular/plural, abbreviations — so the user can
// review and merge them. Used by "Smart Cleanup" in the Ingredients Manager.
function smartCleanupIngredients() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return { success: false, error: 'No Anthropic API key configured. Add ANTHROPIC_API_KEY under Project Settings > Script Properties.' };
  }

  const ingredients = readIngredientsList();
  if (!ingredients || ingredients.length < 2) {
    return { success: true, groups: [] };
  }

  const tool = {
    name: 'record_duplicate_groups',
    description: 'Records groups of ingredient names from the list that refer to the exact same real-world ingredient.',
    input_schema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              members: {
                type: 'array',
                items: { type: 'string' },
                description: 'Ingredient names, copied exactly as given, that all refer to the same real-world ingredient (2 or more).'
              },
              suggestedKeep: { type: 'string', description: 'Which member is the best canonical name to keep — correctly spelled, standard form.' },
              reason: { type: 'string', description: 'Brief reason these are the same ingredient, e.g. "misspelling", "singular/plural", "abbreviation".' }
            },
            required: ['members', 'suggestedKeep', 'reason']
          }
        }
      },
      required: ['groups']
    }
  };

  const payload = {
    model: 'claude-opus-5',
    max_tokens: 4096,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'record_duplicate_groups' },
    messages: [{
      role: 'user',
      content: 'Here is the master ingredients list from a recipe app:\n\n' +
        ingredients.map(i => '- ' + i.name).join('\n') +
        '\n\nFind groups of names that refer to the EXACT SAME real-world ingredient — misspellings, ' +
        'singular/plural variants, abbreviations, or trivial formatting differences (e.g. "Tomatoe" / "Tomato", ' +
        '"Bell Pepper" / "Bell Peppers", "EVOO" / "Extra Virgin Olive Oil"). Do NOT group ingredients that are ' +
        'genuinely different even if similar-sounding — e.g. "Red Bell Pepper" and "Green Bell Pepper" are ' +
        'different ingredients, as are "Chicken Breast" and "Chicken Thigh", or "Butter" and "Peanut Butter". ' +
        'When in doubt, do not group them. Only include groups of 2 or more names. If there are no duplicates, ' +
        'return an empty groups array.'
    }]
  };

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  let result;
  try {
    result = JSON.parse(response.getContentText());
  } catch (e) {
    return { success: false, error: 'Unexpected response from Claude API.' };
  }

  if (result.error) {
    return { success: false, error: result.error.message || 'Claude API error.' };
  }

  const toolUseBlock = (result.content || []).find(block => block.type === 'tool_use');
  if (!toolUseBlock) {
    return { success: false, error: 'Could not analyze the ingredients list — try again.' };
  }

  return { success: true, groups: toolUseBlock.input.groups || [] };
}

// Merges chosen groups of duplicate ingredient names into one canonical name each — across the
// Ingredients master list, and every recipe's RecipeIngredients and RecipeSteps rows that reference
// the old names. mergeOps: [{ keep: "Tomato", remove: ["Tomatoe", "tomatoes"] }, ...]
function mergeIngredients(mergeOps) {
  return withScriptLock(() => {
    if (!mergeOps || mergeOps.length === 0) return { success: true, recipesUpdated: 0 };

    // Case-insensitive rename map: lowercased old name -> canonical name
    const renameMap = {};
    mergeOps.forEach(op => {
      (op.remove || []).forEach(oldName => {
        const key = String(oldName || '').toLowerCase();
        if (key && key !== op.keep.toLowerCase()) renameMap[key] = op.keep;
      });
    });
    if (Object.keys(renameMap).length === 0) return { success: true, recipesUpdated: 0 };

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Drop the merged-away names from the Ingredients master list
    const master = readIngredientsList().filter(i => !renameMap[String(i.name).toLowerCase()]);
    writeIngredientsList(master);

    const recipesUpdated = new Set();

    // 2. Rename matching rows in RecipeIngredients. If renaming makes two rows in the same recipe
    // share the same (name, unit) — e.g. "Tomato" 2 cups and "Tomatoes" 1 cup both becoming
    // "Tomato" — combine them into one row instead of leaving a duplicate ingredient line.
    const ingSheet = ss.getSheetByName('RecipeIngredients');
    if (ingSheet) {
      const data = ingSheet.getDataRange().getValues();
      if (data.length > 1) {
        const header = data[0];
        const rows = data.slice(1);
        const consolidated = [];
        const indexByKey = {};

        rows.forEach(row => {
          const canonical = renameMap[String(row[2] || '').toLowerCase()];
          if (canonical) {
            row[2] = canonical;
            recipesUpdated.add(row[0]);
          }

          const key = row[0] + '|' + String(row[2]).toLowerCase() + '|' + String(row[4]).toLowerCase();
          if (indexByKey[key] !== undefined) {
            consolidated[indexByKey[key]][3] = (Number(consolidated[indexByKey[key]][3]) || 0) + (Number(row[3]) || 0);
          } else {
            indexByKey[key] = consolidated.length;
            consolidated.push(row);
          }
        });

        ingSheet.getRange(2, 1, data.length - 1, header.length).clearContent();
        if (consolidated.length > 0) {
          ingSheet.getRange(2, 1, consolidated.length, header.length).setValues(consolidated);
        }
      }
    }

    // 3. Rename matching ingredient references inside each step's "Ingredients Used" JSON
    const stepsSheet = ss.getSheetByName('RecipeSteps');
    if (stepsSheet) {
      const data = stepsSheet.getDataRange().getValues();
      let changed = false;
      for (let r = 1; r < data.length; r++) {
        const stepIngredients = parseStepIngredients(data[r][3]);
        if (stepIngredients.length === 0) continue;

        let rowChanged = false;
        const updated = stepIngredients.map(ing => {
          const name = typeof ing === 'string' ? ing : ing.name;
          const canonical = renameMap[String(name || '').toLowerCase()];
          if (!canonical) return ing;
          rowChanged = true;
          return typeof ing === 'string' ? canonical : Object.assign({}, ing, { name: canonical });
        });

        if (rowChanged) {
          data[r][3] = JSON.stringify(updated);
          changed = true;
          recipesUpdated.add(data[r][0]);
        }
      }
      if (changed) {
        stepsSheet.getRange(1, 1, data.length, data[0].length).setValues(data);
      }
    }

    return { success: true, recipesUpdated: recipesUpdated.size };
  });
}

// Saves just the master ingredients list (used when a new ingredient is added inline)
function saveIngredientsMasterList(ingredients) {
  return withScriptLock(() => {
    writeIngredientsList(ingredients);
    return { success: true };
  });
}

// Reads a single-column list sheet (e.g. Categories), falling back to defaults if it doesn't exist yet
function readSheetList(sheetName, fallback) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return fallback;
  const items = sheet.getDataRange().getValues().flat().filter(v => v && v.toString().trim() !== "");
  return items.length > 0 ? items : fallback;
}

// Reads the Ingredients sheet (Ingredients | Type | Measurement, with a header row) as master ingredient objects
function readIngredientsList() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Ingredients');
  if (!sheet) return DEFAULT_INGREDIENTS;

  const rows = sheet.getDataRange().getValues();
  rows.shift(); // header row

  const items = rows
    .filter(row => row[0] && row[0].toString().trim() !== "")
    .map(row => ({
      name: row[0],
      category: normalizeIngredientCategory(row[1]),
      unit: normalizeUnit(row[2])
    }));

  return items.length > 0 ? items : DEFAULT_INGREDIENTS;
}

// Overwrites the Ingredients sheet with the given master ingredient objects, creating it if needed
function writeIngredientsList(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Ingredients');
  if (!sheet) sheet = ss.insertSheet('Ingredients');
  sheet.clear();

  sheet.getRange(1, 1, 1, 3).setValues([["Ingredients", "Type", "Measurement"]]).setFontWeight("bold");
  if (items.length > 0) {
    sheet.getRange(2, 1, items.length, 3).setValues(items.map(i => [i.name, i.category || '', i.unit || '']));
  }
}

// Overwrites a single-column list sheet with the given items, creating it if needed
function writeSheetList(sheetName, items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clear();
  if (items.length > 0) {
    sheet.getRange(1, 1, items.length, 1).setValues(items.map(i => [i]));
  }
}

// Helper: updates an existing row or appends a new one if it's a new recipe
function upsertRowByRecipeId(sheet, recipeId, rowData) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == recipeId) {
      sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      return;
    }
  }
  sheet.appendRow(rowData);
}

// Helper: clears old rows for a recipe before writing fresh ones
function clearRowsByRecipeId(sheet, recipeId) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return; // just a header (or empty) — nothing to clear

  const numCols = data[0].length;
  const kept = data.slice(1).filter(row => row[0] != recipeId);

  // Batch clear + rewrite instead of deleting rows one at a time — deleteRow-per-row is the main
  // reason saves felt slow, since each call is its own round trip to the Sheets API.
  sheet.getRange(2, 1, data.length - 1, numCols).clearContent();
  if (kept.length > 0) {
    sheet.getRange(2, 1, kept.length, numCols).setValues(kept);
  }
}

// ONE-TIME CLEANUP for the two recipes corrupted by the save-race bug (now fixed via withScriptLock).
// Run this once from the Apps Script editor, then it can be deleted.
function cleanupDuplicateStepsOneTime() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("RecipeSteps");
  if (!sheet) return;

  clearRowsByRecipeId(sheet, "rec_1787268389521");
  sheet.appendRow(["rec_1787268389521", 1, "Heat olive oil in Dutch oven over medium heat.", "olive oil", ""]);
  sheet.appendRow(["rec_1787268389521", 2, "Add beef chuck and sear until browned on all sides.", "beef chuck", ""]);
  sheet.appendRow(["rec_1787268389521", 3, "Add minced garlic and onions; sauté until fragrant.", "garlic, onions", ""]);

  clearRowsByRecipeId(sheet, "rec_1787268390571");
  sheet.appendRow(["rec_1787268390571", 1, "melt the butter", "Butter", ""]);
  sheet.appendRow(["rec_1787268390571", 2, "cook the onions", "Onions", ""]);

  Logger.log("Cleaned up duplicate steps for both affected recipes.");
}

// Run this function once (from the Apps Script editor) to set up sheet headers and sample data
function setupRecipEZSchema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Setup RecipeList Tab
  let recipeListSheet = ss.getSheetByName("RecipeList");
  if (!recipeListSheet) {
    recipeListSheet = ss.insertSheet("RecipeList");
  } else {
    recipeListSheet.clear();
  }

  recipeListSheet.getRange(1, 1, 1, 8).setValues([[
    "Recipe ID", "Title", "Main Picture", "Category", "Equipment Needed", "Prep Time", "Serving Size", "Created At"
  ]]).setFontWeight("bold").setBackground("#e6f4ea");

  recipeListSheet.appendRow([
    "rec_001",
    "Wintry Beef Stew",
    "https://images.unsplash.com/photo-1547592180-85f173990554",
    "Soups & Stews",
    "Dutch Oven, Chef's Knife, Cutting Board",
    "30 mins",
    "6 servings",
    new Date().getTime()
  ]);

  // 2. Setup RecipeSteps Tab
  let recipeStepsSheet = ss.getSheetByName("RecipeSteps");
  if (!recipeStepsSheet) {
    recipeStepsSheet = ss.insertSheet("RecipeSteps");
  } else {
    recipeStepsSheet.clear();
  }

  recipeStepsSheet.getRange(1, 1, 1, 5).setValues([[
    "Recipe ID", "Step Number", "Instruction", "Ingredients Used", "Step Picture"
  ]]).setFontWeight("bold").setBackground("#e6f4ea");

  recipeStepsSheet.appendRow(["rec_001", 1, "Heat olive oil in Dutch oven over medium heat.", "Olive Oil", ""]);
  recipeStepsSheet.appendRow(["rec_001", 2, "Add beef chuck and sear until browned on all sides.", "Beef Chuck, Salt, Black Pepper", ""]);
  recipeStepsSheet.appendRow(["rec_001", 3, "Add minced garlic and onions; saute until fragrant.", "Garlic, Onions", ""]);

  // 3. Setup RecipeIngredients Tab
  let recipeIngredientsSheet = ss.getSheetByName("RecipeIngredients");
  if (!recipeIngredientsSheet) {
    recipeIngredientsSheet = ss.insertSheet("RecipeIngredients");
  } else {
    recipeIngredientsSheet.clear();
  }

  recipeIngredientsSheet.getRange(1, 1, 1, 6).setValues([[
    "Recipe ID", "Recipe Title", "Ingredient", "Quantity", "Unit", "Note"
  ]]).setFontWeight("bold").setBackground("#e6f4ea");

  recipeIngredientsSheet.appendRow(["rec_001", "Wintry Beef Stew", "Beef Chuck", 2, "lb", ""]);
  recipeIngredientsSheet.appendRow(["rec_001", "Wintry Beef Stew", "Olive Oil", 2, "tbsp", ""]);
  recipeIngredientsSheet.appendRow(["rec_001", "Wintry Beef Stew", "Onions", 1, "Items", ""]);

  // 4. Setup RecipeNotes Tab
  let recipeNotesSheet = ss.getSheetByName("RecipeNotes");
  if (!recipeNotesSheet) {
    recipeNotesSheet = ss.insertSheet("RecipeNotes");
  } else {
    recipeNotesSheet.clear();
  }

  recipeNotesSheet.getRange(1, 1, 1, 4).setValues([[
    "Recipe ID", "Note Number", "Note Text", "Note Picture"
  ]]).setFontWeight("bold").setBackground("#e6f4ea");

  recipeNotesSheet.appendRow(["rec_001", 1, "Tastes even better the next day once the flavors have settled.", ""]);

  Logger.log("RecipEZ setup complete!");
}
