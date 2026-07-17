export interface AccountResponse {
  email: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  organization_id: string;
  user_id: number;
}

export interface OAuthApp {
  app_id: string;
  name: string;
  client_id: string;
  client_secret?: string;
  distribution_type?: 'public' | 'private';
  redirect_uris: string[];
  scopes?: string[];
  logo_uri?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAppResponse {
  app_id: string;
  name: string;
  client_id: string;
  client_secret: string;
  distribution_type?: 'public' | 'private';
  redirect_uris: string[];
  logo_uri?: string;
  created_at: string;
  updated_at: string;
}

// --- DP Functions types ---

export interface DpFunction {
  id: string;
  client_id: number;
  name: string;
  description: string;
  code: string;
  user_prompt: string;
  enriched_prompt: string;
  chat_history: ChatMessage[];
  allowed_mcp_tools: string[];
  scopes: string[];
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface PlanningQA {
  question: string;
  answer: string;
}

export interface SaveFunctionRequest {
  name: string;
  code: string;
  description?: string;
  category?: string;
  attribute_id?: string;
  attribute_type?: string;
  user_prompt?: string;
  enriched_prompt?: string;
  chat_history?: ChatMessage[];
  allowed_mcp_tools?: string[];
  session_id?: string;
}

export interface UpdateFunctionRequest {
  name?: string;
  code?: string;
  description?: string;
}

export interface ValidateResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface ExecuteResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  parameters?: MCPToolParameter[];
  server?: string;
}

export interface MCPToolParameter {
  name: string;
  required: boolean;
  description: string;
  type: string;
}

export interface GenerateRequest {
  user_prompt: string;
  context_json?: unknown;
  qa_history?: PlanningQA[];
  chat_history?: ChatMessage[];
  session_id?: string;
  previous_code?: string;
}

export interface GenerateResponse {
  code: string;
  valid: boolean;
  errors?: string[];
  enriched_prompt: string;
  session_id: string;
  description: string;
  sample_output?: {
    scored_count: number;
    total_count: number;
    samples: { id: string; name?: string; email?: string; score: number }[];
  };
}

export interface TicketResponse {
  ticket: string;
  expires_in: number;
}

export interface WsProgressMessage {
  stage: string;
  message: string;
  data?: unknown;
}

export interface PlanningQuestion {
  id: string;
  question: string;
  options?: string[];
}

export interface PlanningTurnResult {
  question?: PlanningQuestion;
  summary: string;
  done: boolean;
}

export interface ListFunctionsResponse {
  functions: DpFunction[];
  max: number;
}

export interface TestDataExample {
  name: string;
  description?: string;
  data: unknown;
  context?: unknown;
}
