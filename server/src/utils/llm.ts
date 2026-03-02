import OpenAI from 'openai';
import { config } from '../config';

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }
  return openaiClient;
}

export interface LLMCallOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export async function callLLM(
  prompt: string,
  systemPrompt?: string,
  options: LLMCallOptions = {}
): Promise<string> {
  const client = getOpenAIClient();
  
  const {
    temperature = 0.7,
    maxTokens = 2000,
    jsonMode = false,
  } = options;
  
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  
  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: systemPrompt,
    });
  }
  
  messages.push({
    role: 'user',
    content: prompt,
  });
  
  // Try primary model (GPT-5.2)
  try {
    console.log(`[LLM] Calling primary model: ${config.openai.model}`);
    
    // GPT-5 models use max_completion_tokens instead of max_tokens
    const isGPT5 = config.openai.model.includes('gpt-5');
    const tokenParam = isGPT5 ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
    
    const response = await client.chat.completions.create({
      model: config.openai.model,
      messages,
      temperature,
      ...tokenParam,
      response_format: jsonMode ? { type: 'json_object' } : undefined,
    });
    
    const content = response.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content returned from LLM');
    }
    
    return content;
  } catch (primaryError: any) {
    // If primary model fails, try fallback model
    const isFallbackAvailable = config.openai.fallbackModel && config.openai.fallbackModel !== config.openai.model;
    const isModelError = primaryError?.status === 404 || primaryError?.code === 'model_not_found' || primaryError?.error?.code === 'model_not_found';
    
    if (isFallbackAvailable && isModelError) {
      console.warn(`[LLM] Primary model ${config.openai.model} failed, trying fallback: ${config.openai.fallbackModel}`);
      
      try {
        // GPT-5 models use max_completion_tokens instead of max_tokens
        const isFallbackGPT5 = config.openai.fallbackModel.includes('gpt-5');
        const fallbackTokenParam = isFallbackGPT5 ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
        
        const response = await client.chat.completions.create({
          model: config.openai.fallbackModel,
          messages,
          temperature,
          ...fallbackTokenParam,
          response_format: jsonMode ? { type: 'json_object' } : undefined,
        });
        
        const content = response.choices[0]?.message?.content;
        
        if (!content) {
          throw new Error('No content returned from fallback LLM');
        }
        
        console.log('[LLM] Fallback model succeeded');
        return content;
      } catch (fallbackError) {
        console.error('[LLM] Fallback model also failed:', fallbackError);
        throw new Error(`Both primary and fallback models failed. Primary: ${primaryError instanceof Error ? primaryError.message : 'Unknown error'}. Fallback: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`);
      }
    }
    
    // If no fallback or different error, throw original error
    console.error('[LLM] Error calling LLM:', primaryError);
    throw new Error(`LLM call failed: ${primaryError instanceof Error ? primaryError.message : 'Unknown error'}`);
  }
}

export async function callLLMWithJSON<T = any>(
  prompt: string,
  systemPrompt?: string,
  options: LLMCallOptions = {}
): Promise<T> {
  // For arrays, don't use strict JSON mode - parse manually for better control
  const response = await callLLM(prompt, systemPrompt, {
    ...options,
    jsonMode: false, // Disable strict JSON mode for arrays
  });
  
  try {
    // Extract JSON from response (might have extra text)
    const jsonMatch = response.match(/\[[\s\S]*\]/) || response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as T;
    }
    // Try parsing the whole response
    return JSON.parse(response) as T;
  } catch (error) {
    console.error('Error parsing JSON from LLM response:', response);
    throw new Error('Failed to parse JSON from LLM response');
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenAIClient();
  
  try {
    const response = await client.embeddings.create({
      model: config.openai.embeddingModel,
      input: text,
    });
    
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function batchGenerateEmbeddings(texts: string[]): Promise<number[][]> {
  const client = getOpenAIClient();
  
  try {
    const response = await client.embeddings.create({
      model: config.openai.embeddingModel,
      input: texts,
    });
    
    return response.data.map(item => item.embedding);
  } catch (error) {
    console.error('Error generating batch embeddings:', error);
    throw new Error(`Batch embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}






