import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

// Configuration
const API_URL = 'http://localhost:3000/api/questions/upload';
const FILE_PATH = './test-files/sample.pdf'; // Change this to your test file path

async function testFileUpload() {
  try {
    // Check if file exists
    if (!fs.existsSync(FILE_PATH)) {
      console.error(`File not found: ${FILE_PATH}`);
      return;
    }

    // Create form data
    const form = new FormData();
    form.append('document', fs.createReadStream(FILE_PATH));
    
    console.log('Sending file upload request...');
    
    // Send request
    const response = await fetch(API_URL, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });
    
    // Parse response
    const data = await response.json();
    
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
  } catch (error) {
    console.error('Error during file upload test:', error);
  }
}

// Run the test
testFileUpload(); 