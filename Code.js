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
      steps: stepsByRecipe[id] || []
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

  Logger.log("RecipEZ setup complete!");
}
