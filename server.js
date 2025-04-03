import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const port = process.env.PORT || 5007;

// Initialize Google Generative AI with the API key
const genAI = new GoogleGenerativeAI('AIzaSyB5xvzwI1Ub3hRU0UN7eBCrlw-79C2xrt0');

// Set up multer for file uploads
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max file size
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Not an image! Please upload an image file.'), false);
    }
  }
});

app.use(cors());
app.use(express.json());

// Function to convert image to base64
async function imageToBase64(filePath) {
  const fileData = fs.readFileSync(filePath);
  return fileData.toString('base64');
}

// Helper function to remove uploaded files
function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Error removing file:', err);
  }
}

// Create an endpoint for analyzing images
app.post('/api/analyze-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Read the image file as buffer
    const imageBuffer = fs.readFileSync(req.file.path);
    
    // Convert the buffer to a base64 string which is what the API expects
    const base64Image = imageBuffer.toString('base64');

    // Get a gemini model that can work with both text and images
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Generate the content
    const result = await model.generateContent([
      "Analyze this food image and list all visible ingredients. Return just the ingredient names as a simple comma-separated list, with no additional formatting or explanation.",
      {
        inlineData: {
          mimeType: req.file.mimetype,
          data: base64Image
        }
      }
    ]);

    const response = await result.response;
    const text = response.text();
    
    // Parse the text response into a list of ingredients
    const ingredients = text
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);

    // Remove the temporary file
    fs.unlinkSync(req.file.path);

    // Return the list of ingredients
    res.json({ ingredients });
  } catch (error) {
    console.error('Error analyzing image:', error);
    res.status(500).json({ 
      error: 'Failed to analyze image', 
      details: error.message 
    });
  }
});

// Create an endpoint for generating recipes
app.post('/api/generate-recipe', async (req, res) => {
  try {
    const { ingredients, cuisine, dietaryRestrictions } = req.body;

    // Validate input
    if (!ingredients) {
      return res.status(400).json({ error: 'Ingredients are required' });
    }

    // Access the generative model (Gemini)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Create the prompt for recipe generation
    const prompt = `Create a detailed recipe using these ingredients: ${ingredients}.
      ${cuisine && cuisine !== 'Any' ? `The cuisine should be ${cuisine}.` : ''}
      ${dietaryRestrictions && dietaryRestrictions !== 'None' ? `Please ensure the recipe is ${dietaryRestrictions}.` : ''}
      
      Format the recipe with these sections:
      - Recipe Name
      - Ingredients (with measurements)
      - Instructions (step-by-step)
      - Cooking Time
      - Servings
      - Dietary Information
      - Tips and Variations
      - Nutritional Information (approximate)
      
      Be creative but practical, and make sure all the provided ingredients are used.`;

    // Generate content with the prompt
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // Get the generated recipe text
    const recipe = response.text();

    // Return the recipe
    res.json({ recipe });
  } catch (error) {
    console.error('Error generating recipe:', error);
    res.status(500).json({ 
      error: 'Failed to generate recipe', 
      details: error.message 
    });
  }
});

// Create an endpoint for finding recipe videos
app.post('/api/find-recipe-video', async (req, res) => {
  try {
    const { recipeName, ingredients, cuisine } = req.body;

    if (!recipeName) {
      return res.status(400).json({ error: 'Recipe name is required' });
    }

    // Access the generative model (Gemini)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Create a prompt to generate a YouTube search query with more specific parameters for better results
    const prompt = `Create a precise YouTube search query for a recipe tutorial.
    
    Recipe: ${recipeName}
    ${ingredients ? `Main ingredients: ${ingredients}` : ''}
    ${cuisine ? `Cuisine type: ${cuisine}` : ''}
    
    INSTRUCTIONS:
    1. Format the query to find reliable recipe tutorials.
    2. Include the exact recipe name and essential ingredients.
    3. Add phrases like "recipe tutorial" or "how to make" to target instructional videos.
    4. Keep it between 5-10 words for optimal YouTube search results.
    5. Avoid generic terms like "best" or "top" unless part of the recipe name.
    6. Focus on popular cooking terms that will yield multiple high-quality results.
    
    Your response should ONLY contain the optimized search query text - no explanations, quotes, or additional formatting.
    Example output: "authentic chicken tikka masala recipe tutorial"`;

    // Generate the search query
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const searchQuery = response.text().trim();

    // Return different YouTube URL formats for maximum compatibility
    res.json({ 
      searchQuery,
      // Standard nocookie domain for better privacy
      youtubeEmbedUrl: `https://www.youtube-nocookie.com/embed?search=${encodeURIComponent(searchQuery)}`,
      // Alternative formats to try
      youtubeFirstResultUrl: `https://www.youtube-nocookie.com/embed?search=${encodeURIComponent(searchQuery)}`,
      // Direct search URL for fallback
      youtubeSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`
    });
  } catch (error) {
    console.error('Error finding recipe video:', error);
    res.status(500).json({ 
      error: 'Failed to find recipe video', 
      details: error.message 
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
