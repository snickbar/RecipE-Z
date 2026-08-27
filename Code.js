// Serves the HTML file when visiting the web app URL
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('RecipEZ - Recipe Keeper')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Includes external HTML files (like CSS or JS partials if needed)
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Fetch all recipes from RecipeList sheet
function getRecipes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Read RecipeList
  const listSheet = ss.getSheetByName("RecipeList");
  const listData = listSheet.getDataRange().getValues();
  listData.shift(); // Remove headers
  
  // Read RecipeSteps
  const stepsSheet = ss.getSheetByName("RecipeSteps");
  const stepsData = stepsSheet.getDataRange().getValues();
  stepsData.shift(); // Remove headers
  
  // Map steps by Recipe ID
  const stepsByRecipe = {};
  stepsData.forEach(row => {
    const recipeId = row[0];
    if (!stepsByRecipe[recipeId]) stepsByRecipe[recipeId] = [];
    stepsByRecipe[recipeId].push({
      stepNumber: row[1],
      instruction: row[2],
      ingredients: row[3],
      stepPicture: row[4]
    });
  });

  // Build combined recipe objects
  return listData.map(row => {
    const id = row[0];
    const recipeSteps = stepsByRecipe[id] || [];
    
    const formattedSteps = recipeSteps.map(step => {
      let ing = step.ingredients;
      if (typeof ing === 'string') {
        ing = ing ? ing.split(',').map(s => s.trim()) : [];
      }
      return {
        stepNumber: step.stepNumber,
        instruction: step.instruction,
        ingredients: Array.isArray(ing) ? ing : [],
        stepPicture: step.stepPicture
      };
    });

    return {
      id: id,
      title: row[1],
      mainPicture: row[2],
      category: row[3],
      equipment: row[4],
      prepTime: row[5],
      servings: row[6],
      steps: formattedSteps
    };
  });
}

// Fetch master ingredients list from Ingredients sheet
function getIngredients() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ingredients");
  const data = sheet.getDataRange().getValues();
  
  const ingredients = data.flat().filter(item => item && item.toString().trim() !== "" && item !== "INGREDIENTS");
  return ingredients;
}

// Save a new recipe to RecipeList
function addRecipe(recipeName) {
  if (!recipeName || recipeName.trim() === "") return { success: false, message: "Recipe name empty" };
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("RecipeList");
  sheet.appendRow([recipeName.trim()]);
  return { success: true };
}
// Run this function once to set up the headers and sample data automatically!
function setupRecipEZSchema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Setup RecipeList Tab
  let recipeListSheet = ss.getSheetByName("RecipeList");
  if (!recipeListSheet) {
    recipeListSheet = ss.insertSheet("RecipeList");
  } else {
    recipeListSheet.clear(); // Clear existing text list to set up table
  }
  
  recipeListSheet.getRange(1, 1, 1, 7).setValues([[
    "Recipe ID", "Title", "Main Picture", "Category", "Equipment Needed", "Prep Time", "Serving Size"
  ]]).setFontWeight("bold").setBackground("#e6f4ea");
  
  // Add sample recipe row
  recipeListSheet.appendRow([
    "rec_001", 
    "Wintry Beef Stew", 
    "https://images.unsplash.com/photo-1547592180-85f173990554", 
    "Soups & Stews", 
    "Dutch Oven, Chef's Knife, Cutting Board", 
    "30 mins", 
    "6 servings"
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
  
  // Add sample steps connected to rec_001
  recipeStepsSheet.appendRow([
    "rec_001", 1, "Heat olive oil in Dutch oven over medium heat.", "2 tbsp olive oil", ""
  ]);
  recipeStepsSheet.appendRow([
    "rec_001", 2, "Add beef chuck and sear until browned on all sides.", "2 lbs beef chuck, 1 tsp salt, 1/2 tsp pepper", ""
  ]);
  recipeStepsSheet.appendRow([
    "rec_001", 3, "Add minced garlic and onions; sauté until fragrant.", "3 cloves minced garlic, 1 large onion", ""
  ]);

  Logger.log("RecipEZ setup complete!");
}
// Saves a new recipe from the Recipe Manager form
function saveNewRecipe(recipeData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const listSheet = ss.getSheetByName("RecipeList");
  const stepsSheet = ss.getSheetByName("RecipeSteps");
  const ingSheet = ss.getSheetByName("RecipeIngredients");
  
  // Generate unique ID if not present
  const recipeId = recipeData.id || ("rec_" + new Date().getTime());
  
  // 1. Append or Update RecipeList
  upsertRowByRecipeId(listSheet, recipeId, [
    recipeId,
    recipeData.title,
    recipeData.mainPicture || "",
    recipeData.category || "General",
    recipeData.equipment || "",
    recipeData.prepTime || "",
    recipeData.servings || ""
  ]);
  
  // 2. Clear and Update RecipeSteps (filtering out blank junk rows)
  clearRowsByRecipeId(stepsSheet, recipeId);
  if (recipeData.steps && recipeData.steps.length > 0) {
    recipeData.steps.forEach((step, idx) => {
      // Get instruction text safely
      const instructionText = typeof step === 'string' ? step : (step.text || step.instruction || "");
      
      // Skip completely empty steps to prevent junk rows
      if (!instructionText.trim()) return;

      // Format ingredients safely into a string
      let rawIngs = step.ingredients || "";
      let ingText = "";
      if (Array.isArray(rawIngs)) {
        ingText = rawIngs.join(', ');
      } else if (typeof rawIngs === 'string') {
        ingText = rawIngs;
      }

      stepsSheet.appendRow([
        recipeId,
        idx + 1,
        instructionText,
        ingText,
        step.picture || ""
      ]);
    });
  }

  // 3. Clear and Update RecipeIngredients
  clearRowsByRecipeId(ingSheet, recipeId);
  if (recipeData.ingredients && recipeData.ingredients.length > 0) {
    recipeData.ingredients.forEach(ing => {
      ingSheet.appendRow([
        recipeId,
        recipeData.title,
        ing.name || "",
        ing.qty || 0,
        ing.unit || ""
      ]);
    });
  }
  
  return { success: true, recipeId: recipeId };
}
// Handles incoming POST requests from your website
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (data.action === 'saveRecipe') {
      var recipe = data.recipe;
      
      // 1. Update RecipeList
      var listSheet = ss.getSheetByName('RecipeList');
      upsertRowByRecipeId(listSheet, recipe.recipeId, [
        recipe.recipeId, recipe.title, recipe.mainPicture, recipe.category, recipe.equipmentNeeded, recipe.prepTime, recipe.servingSize
      ]);
      
      // 2. Update RecipeSteps
      var stepsSheet = ss.getSheetByName('RecipeSteps');
      clearRowsByRecipeId(stepsSheet, recipe.recipeId);
      if (recipe.steps) {
        recipe.steps.forEach(function(step) {
          stepsSheet.appendRow([recipe.recipeId, step.stepNumber, step.instruction, step.ingredientsUsed, step.stepPicture]);
        });
      }
      
      // 3. Update RecipeIngredients
      var ingSheet = ss.getSheetByName('RecipeIngredients');
      clearRowsByRecipeId(ingSheet, recipe.recipeId);
      if (recipe.ingredients) {
        recipe.ingredients.forEach(function(ing) {
          ingSheet.appendRow([recipe.recipeId, recipe.title, ing.ingredient, ing.quantity, ing.measurement]);
        });
      }
      
      return ContentService.createTextOutput(JSON.stringify({status: 'success'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: 'error', message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Handles simple test checks (fixes the doGet error)
function doGet(e) {
  // This tells Google Apps Script to serve your index.html file when someone visits your web app URL
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Recipe-Z')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Helper: Updates an existing row or appends a new one if it's a new recipe
function upsertRowByRecipeId(sheet, recipeId, rowData) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == recipeId) {
      sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      return;
    }
  }
  sheet.appendRow(rowData);
}

// Helper: Clears old rows for a recipe before writing fresh ones
function clearRowsByRecipeId(sheet, recipeId) {
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] == recipeId) {
      sheet.deleteRow(i + 1);
    }
  }
}
// Bridge function to save app data from the frontend into your existing setup
function saveAppData(dataObject) {
  if (dataObject && dataObject.recipes) {
    dataObject.recipes.forEach(recipe => {
      saveNewRecipe(recipe);
    });
  }
  return { success: true };
}