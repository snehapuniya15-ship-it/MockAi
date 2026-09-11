import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: "Groq API Key (GROQ_API_KEY) is missing in server environment variables." },
        { status: 500 }
      );
    }

    const body = await req.json();

    const rawMessages = body.messages || body.history || body.chatHistory || [];
    const singlePrompt = body.prompt || body.message || body.userMessage;
    const isFinalQuery = body.isFinalQuery || false; 

    // Dynamically set the System Prompt based on whether the interview is ending
    let systemPrompt = "You are a professional, friendly technical interviewer. Keep your responses short, natural, and conversational. Ask only ONE question at a time. Do not write long paragraphs or give explanations unless asked. Your spoken responses should be concise (1-3 sentences max) so they sound good when read out loud.";

    if (isFinalQuery) {
      systemPrompt = `You are an expert technical recruiter evaluating an interview. 
      Review the conversation history and output ONLY a valid JSON object evaluating the candidate.
      
      CRITICAL EVALUATION RULES:
      1. If the candidate successfully answered technical questions, evaluate them honestly and give a score between 1 and 100.
      2. If the candidate DID NOT answer any technical questions, gave empty answers, or ended the interview immediately, you MUST give a score of 0. Their strengths should be "None detected" and improvements should explicitly state that the interview was ended before assessment could occur.

      Use this exact JSON structure:
      {
        "isEnded": true,
        "evaluation": {
          "score": <NUMBER>,
          "strengths": ["<Dynamic strength>"],
          "improvements": ["<Dynamic improvement>"]
        },
        "aiReply": "Thank you for your time. I have compiled your evaluation."
      }
      Do not output any markdown formatting (no \`\`\`json), conversational filler, or extra text. ONLY raw JSON.`;
    }

    let formattedContents = [
      {
        role: "system",
        content: systemPrompt
      }
    ];

    if (Array.isArray(rawMessages) && rawMessages.length > 0) {
      const mappedHistory = rawMessages.map(msg => ({
        role: msg.role === 'ai' || msg.role === 'model' || msg.role === 'interviewer' ? 'assistant' : 'user',
        content: msg.content || msg.text || ""
      }));
      formattedContents.push(...mappedHistory);
    } 
    
    if (singlePrompt) {
      formattedContents.push({
        role: 'user',
        content: String(singlePrompt)
      });
    }

    // Using active model confirmed by your Groq account
    const requestPayload = {
      model: 'openai/gpt-oss-120b', 
      messages: formattedContents,
      temperature: isFinalQuery ? 0.2 : 0.7
    };

    if (isFinalQuery) {
      requestPayload.response_format = { type: "json_object" };
    }

    const apiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify(requestPayload)
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error("Groq API Target Error:", errorText);
      return NextResponse.json(
        { error: `Groq API rejected request: ${apiResponse.statusText}`, details: errorText },
        { status: apiResponse.status }
      );
    }

    const data = await apiResponse.json();
    const aiTextResponse = data.choices?.[0]?.message?.content;

    if (!aiTextResponse) {
      throw new Error("Empty content returned from Groq model.");
    }

    console.log("=== SENDING TO FRONTEND ===", aiTextResponse);

    // Clean any markdown formatting if present
    const cleanJsonString = aiTextResponse
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(cleanJsonString);
      if (parsed && typeof parsed === 'object') {
        if (!parsed.aiReply) {
          parsed.aiReply = parsed.text || parsed.message || parsed.content || cleanJsonString;
        }
        return NextResponse.json(parsed);
      }
    } catch {
      // Fallback for regular conversation text
    }

    return NextResponse.json({ 
      aiReply: aiTextResponse,
      response: aiTextResponse,
      text: aiTextResponse,
      message: aiTextResponse,
      content: aiTextResponse
    });

  } catch (error) {
    console.error("Groq Route Handler Exception:", error);
    return NextResponse.json(
      { error: "Internal Server Processing Error", details: error.message },
      { status: 500 }
    );
  }
}
