import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { validateRequest } from '../utils/validation';
import { AssemblePromptRequestSchema } from '../utils/validation';
import { AssemblePromptResponse } from '../types';
import { memoryRetriever } from '../services/retriever';
import { contextAssembler } from '../services/assembler';

const router = Router();

/**
 * POST /assemble_prompt
 * Assemble a prompt with memory context injected
 */
router.post('/', asyncHandler(async (req, res) => {
  // Get authenticated user ID (override any userId in body)
  const authenticatedUserId = req.user?.userId || 'anonymous';
  
  // Validate request
  const validatedData = validateRequest(AssemblePromptRequestSchema, req.body);
  
  const { agentInstructions, userInput, tokenBudget = 2000 } = validatedData;
  const userId = authenticatedUserId; // Use authenticated user
  
  // Retrieve relevant memories
  const results = await memoryRetriever.retrieve({
    userId,
    query: userInput,
    k: 15, // Get more for better context
  });
  
  // Assemble context block
  const contextBlock = contextAssembler.assembleContextBlock(
    results,
    tokenBudget
  );
  
  // Assemble final prompt
  const assembledPrompt = contextAssembler.assemblePromptWithMemory(
    agentInstructions,
    userInput,
    contextBlock
  );
  
  const response: AssemblePromptResponse = {
    success: true,
    assembledPrompt,
    contextBlock,
    usedMemories: contextBlock.memoryIds,
  };
  
  res.json(response);
}));

export default router;






