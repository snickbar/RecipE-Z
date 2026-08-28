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

// Serves the app's HTML when visiting the web app URL
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('RecipE-Z - Recipe Keeper')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
    ingredientsByRecipe[recipeId].push({ name: row[2], qty: row[3], unit: row[4] });
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

// Save (or update) one recipe across RecipeList, RecipeSteps, and RecipeIngredients
function saveNewRecipe(recipeData) {
  return withScriptLock(() => {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const listSheet = ss.getSheetByName("RecipeList");
  const stepsSheet = ss.getSheetByName("RecipeSteps");
  const ingSheet = ss.getSheetByName("RecipeIngredients") || ss.insertSheet("RecipeIngredients");
  const notesSheet = ss.getSheetByName("RecipeNotes") || ss.insertSheet("RecipeNotes");

  const recipeId = recipeData.id || ("rec_" + new Date().getTime());

  upsertRowByRecipeId(listSheet, recipeId, [
    recipeId,
    recipeData.title,
    recipeData.mainPicture || "",
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

      stepRows.push([recipeId, stepRows.length + 1, instructionText, ingText, step.picture || ""]);
    });
    if (stepRows.length > 0) {
      stepsSheet.getRange(stepsSheet.getLastRow() + 1, 1, stepRows.length, 5).setValues(stepRows);
    }
  }

  clearRowsByRecipeId(ingSheet, recipeId);
  if (recipeData.ingredients && recipeData.ingredients.length > 0) {
    const ingRows = recipeData.ingredients.map(ing => [recipeId, recipeData.title, ing.name || "", ing.qty || 0, ing.unit || ""]);
    ingSheet.getRange(ingSheet.getLastRow() + 1, 1, ingRows.length, 5).setValues(ingRows);
  }

  clearRowsByRecipeId(notesSheet, recipeId);
  if (recipeData.notes && recipeData.notes.length > 0) {
    const noteRows = [];
    recipeData.notes.forEach(note => {
      const noteText = typeof note === 'string' ? note : (note.text || "");
      if (!noteText.trim()) return; // skip empty notes to avoid junk rows
      noteRows.push([recipeId, noteRows.length + 1, noteText, note.picture || ""]);
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

  recipeIngredientsSheet.getRange(1, 1, 1, 5).setValues([[
    "Recipe ID", "Recipe Title", "Ingredient", "Quantity", "Unit"
  ]]).setFontWeight("bold").setBackground("#e6f4ea");

  recipeIngredientsSheet.appendRow(["rec_001", "Wintry Beef Stew", "Beef Chuck", 2, "lb"]);
  recipeIngredientsSheet.appendRow(["rec_001", "Wintry Beef Stew", "Olive Oil", 2, "tbsp"]);
  recipeIngredientsSheet.appendRow(["rec_001", "Wintry Beef Stew", "Onions", 1, "Items"]);

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
