const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');

initializeApp();
const db = getFirestore();

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

// Smart Import and Smart Cleanup call the Anthropic API on every use — restricting them to just
// the app owner's account keeps real-world Blaze-plan spend bounded to one person's usage instead
// of exposed to every signed-up account, per the migration plan.
const OWNER_EMAIL = 'snickbar@gmail.com';

function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  return request.auth;
}

function requireOwner(request) {
  const auth = requireAuth(request);
  if (auth.token.email !== OWNER_EMAIL) {
    throw new HttpsError('permission-denied', 'This feature is only available to the app owner right now.');
  }
  return auth;
}

async function callAnthropic(apiKey, payload) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });
  let result;
  try {
    result = await response.json();
  } catch (e) {
    throw new HttpsError('internal', 'Unexpected response from Claude API.');
  }
  if (result.error) {
    throw new HttpsError('internal', result.error.message || 'Claude API error.');
  }
  return result;
}

// --- Smart Import: parse pasted recipe text into structured fields (ported from Code.js
// smartImportRecipe, same tool schema/prompt, UrlFetchApp -> fetch) ---
exports.smartImportRecipe = onCall({ secrets: [anthropicApiKey] }, async (request) => {
  requireOwner(request);
  const rawText = request.data && request.data.rawText;
  if (!rawText || !rawText.trim()) {
    throw new HttpsError('invalid-argument', 'No recipe text provided.');
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

  const result = await callAnthropic(anthropicApiKey.value(), payload);
  const toolUseBlock = (result.content || []).find(block => block.type === 'tool_use');
  if (!toolUseBlock) {
    throw new HttpsError('internal', 'Could not parse that recipe — try pasting more of it, or check the formatting.');
  }
  return { success: true, recipe: toolUseBlock.input };
});

// --- Smart Cleanup: find duplicate ingredient names in the caller's own master list (ported from
// Code.js smartCleanupIngredients, reads users/{uid}/meta/appData instead of the Ingredients sheet) ---
exports.smartCleanupIngredients = onCall({ secrets: [anthropicApiKey] }, async (request) => {
  const auth = requireOwner(request);

  const metaRef = db.doc(`users/${auth.uid}/meta/appData`);
  const metaSnap = await metaRef.get();
  const ingredients = (metaSnap.exists && metaSnap.data().ingredients) || [];
  if (ingredients.length < 2) return { success: true, groups: [] };

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
        ingredients.map((i) => '- ' + i.name).join('\n') +
        '\n\nFind groups of names that refer to the EXACT SAME real-world ingredient — misspellings, ' +
        'singular/plural variants, abbreviations, or trivial formatting differences (e.g. "Tomatoe" / "Tomato", ' +
        '"Bell Pepper" / "Bell Peppers", "EVOO" / "Extra Virgin Olive Oil"). Do NOT group ingredients that are ' +
        'genuinely different even if similar-sounding — e.g. "Red Bell Pepper" and "Green Bell Pepper" are ' +
        'different ingredients, as are "Chicken Breast" and "Chicken Thigh", or "Butter" and "Peanut Butter". ' +
        'When in doubt, do not group them. Only include groups of 2 or more names. If there are no duplicates, ' +
        'return an empty groups array.'
    }]
  };

  const result = await callAnthropic(anthropicApiKey.value(), payload);
  const toolUseBlock = (result.content || []).find(block => block.type === 'tool_use');
  if (!toolUseBlock) {
    throw new HttpsError('internal', 'Could not analyze the ingredients list — try again.');
  }
  return { success: true, groups: toolUseBlock.input.groups || [] };
});

// --- Merge Ingredients: rename/consolidate duplicate ingredient names across the caller's own
// master list and every one of their recipes (ported from Code.js mergeIngredients, reshaped for
// Firestore's one-doc-per-recipe model instead of the Sheets RecipeIngredients/RecipeSteps rows).
// mergeOps: [{ keep: "Tomato", remove: ["Tomatoe", "tomatoes"] }, ...] ---
exports.mergeIngredients = onCall({ secrets: [anthropicApiKey] }, async (request) => {
  const auth = requireOwner(request);
  const mergeOps = request.data && request.data.mergeOps;
  if (!mergeOps || mergeOps.length === 0) return { success: true, recipesUpdated: 0 };

  const renameMap = {};
  mergeOps.forEach((op) => {
    (op.remove || []).forEach((oldName) => {
      const key = String(oldName || '').toLowerCase();
      if (key && key !== op.keep.toLowerCase()) renameMap[key] = op.keep;
    });
  });
  if (Object.keys(renameMap).length === 0) return { success: true, recipesUpdated: 0 };

  const metaRef = db.doc(`users/${auth.uid}/meta/appData`);
  const metaSnap = await metaRef.get();
  const meta = metaSnap.exists ? metaSnap.data() : {};
  const master = (meta.ingredients || []).filter((i) => !renameMap[String(i.name).toLowerCase()]);
  await metaRef.set({ ...meta, ingredients: master }, { merge: true });

  const recipesRef = db.collection(`users/${auth.uid}/recipes`);
  const recipesSnap = await recipesRef.get();

  let recipesUpdated = 0;
  const batchSize = 400; // stay under Firestore's 500-write batch cap with room to spare
  let batch = db.batch();
  let opsInBatch = 0;

  for (const doc of recipesSnap.docs) {
    const recipe = doc.data();
    let changed = false;

    // Rename + consolidate duplicate (name, unit) pairs within this recipe's ingredients list
    if (Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0) {
      const consolidated = [];
      const indexByKey = {};
      recipe.ingredients.forEach((ing) => {
        const canonical = renameMap[String(ing.name || '').toLowerCase()];
        const name = canonical || ing.name;
        if (canonical) changed = true;
        const key = String(name).toLowerCase() + '|' + String(ing.unit || '').toLowerCase();
        if (indexByKey[key] !== undefined) {
          consolidated[indexByKey[key]].qty = (Number(consolidated[indexByKey[key]].qty) || 0) + (Number(ing.qty) || 0);
        } else {
          indexByKey[key] = consolidated.length;
          consolidated.push({ ...ing, name });
        }
      });
      recipe.ingredients = consolidated;
    }

    // Rename matching ingredient references inside each step's ingredients array
    if (Array.isArray(recipe.steps) && recipe.steps.length > 0) {
      recipe.steps = recipe.steps.map((step) => {
        if (!Array.isArray(step.ingredients) || step.ingredients.length === 0) return step;
        const updatedIngredients = step.ingredients.map((ing) => {
          const name = typeof ing === 'string' ? ing : ing.name;
          const canonical = renameMap[String(name || '').toLowerCase()];
          if (!canonical) return ing;
          changed = true;
          return typeof ing === 'string' ? canonical : { ...ing, name: canonical };
        });
        return { ...step, ingredients: updatedIngredients };
      });
    }

    if (changed) {
      recipesUpdated++;
      batch.update(doc.ref, { ingredients: recipe.ingredients, steps: recipe.steps, updatedAt: FieldValue.serverTimestamp() });
      opsInBatch++;
      if (opsInBatch >= batchSize) {
        await batch.commit();
        batch = db.batch();
        opsInBatch = 0;
      }
    }
  }
  if (opsInBatch > 0) await batch.commit();

  return { success: true, recipesUpdated };
});

// --- Share / Unshare: publish a copy of one of the caller's own recipes into the public
// sharedRecipes library, or remove it. Kept server-side (Admin SDK) so the public copy's shape is
// always exactly what these functions produce, never a client-trusted write. ---
exports.shareRecipe = onCall(async (request) => {
  const auth = requireAuth(request);
  const recipeId = request.data && request.data.recipeId;
  if (!recipeId) throw new HttpsError('invalid-argument', 'recipeId is required.');

  const recipeRef = db.doc(`users/${auth.uid}/recipes/${recipeId}`);
  const recipeSnap = await recipeRef.get();
  if (!recipeSnap.exists || recipeSnap.data().ownerId !== auth.uid) {
    throw new HttpsError('not-found', 'Recipe not found.');
  }
  const recipe = recipeSnap.data();

  const sharedRef = recipe.sharedRecipeId
    ? db.doc(`sharedRecipes/${recipe.sharedRecipeId}`)
    : db.collection('sharedRecipes').doc();

  await sharedRef.set({
    title: recipe.title || '',
    mainPicture: recipe.mainPicture || '',
    category: recipe.category || '',
    equipment: recipe.equipment || '',
    prepTime: recipe.prepTime || '',
    servings: recipe.servings || '',
    ingredients: recipe.ingredients || [],
    steps: recipe.steps || [],
    notes: recipe.notes || [],
    ownerId: auth.uid,
    ownerDisplayName: auth.token.name || auth.token.email || 'A RecipE-Z user',
    originalRecipeId: recipeId,
    titleLower: String(recipe.title || '').toLowerCase(),
    sharedAt: recipe.sharedAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  await recipeRef.update({ shared: true, sharedRecipeId: sharedRef.id });
  return { success: true, sharedRecipeId: sharedRef.id };
});

exports.unshareRecipe = onCall(async (request) => {
  const auth = requireAuth(request);
  const recipeId = request.data && request.data.recipeId;
  if (!recipeId) throw new HttpsError('invalid-argument', 'recipeId is required.');

  const recipeRef = db.doc(`users/${auth.uid}/recipes/${recipeId}`);
  const recipeSnap = await recipeRef.get();
  if (!recipeSnap.exists || recipeSnap.data().ownerId !== auth.uid) {
    throw new HttpsError('not-found', 'Recipe not found.');
  }
  const recipe = recipeSnap.data();

  if (recipe.sharedRecipeId) {
    await db.doc(`sharedRecipes/${recipe.sharedRecipeId}`).delete().catch((e) => {
      logger.warn('sharedRecipes doc already gone for ' + recipeId, e);
    });
  }
  await recipeRef.update({ shared: false, sharedRecipeId: null });
  return { success: true };
});
