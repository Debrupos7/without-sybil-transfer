import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: { contract: string } }
) {
  const { contract } = params;
  
  console.log('API Route called for contract:', contract);
  
  // Validate contract name to prevent directory traversal
  if (!contract.match(/^[a-zA-Z]+$/)) {
    console.log('Invalid contract name:', contract);
    return NextResponse.json(
      { error: 'Invalid contract name' },
      { status: 400 }
    );
  }
  
  try {
    // Resolve the absolute path to the app/contracts directory
    const contractsDir = path.join(process.cwd(), 'src', 'app', 'contracts');
    // Get the file path for the requested contract
    const filePath = path.join(contractsDir, `${contract}.sol`);
    
    console.log('Trying to read contract from:', filePath);
    
    // Check if the file exists
    const fileExists = fs.existsSync(filePath);
    console.log('File exists:', fileExists);
    
    if (!fileExists) {
      console.log('Contract file not found at path:', filePath);
      
      // List contents of the directory to debug
      try {
        const dirContents = fs.readdirSync(contractsDir);
        console.log('Contents of contracts directory:', dirContents);
      } catch (dirError) {
        console.error('Error reading contracts directory:', dirError);
      }
      
      return NextResponse.json(
        { error: 'Contract not found' },
        { status: 404 }
      );
    }
    
    // Read the file content
    const fileContent = fs.readFileSync(filePath, 'utf8');
    console.log(`Successfully read ${contract}.sol, content length:`, fileContent.length);
    
    // Return the file content as text
    return new NextResponse(fileContent, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error('Error reading contract file:', error);
    return NextResponse.json(
      { error: 'Failed to read contract file', details: String(error) },
      { status: 500 }
    );
  }
} 