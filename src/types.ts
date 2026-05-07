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
  public?: boolean;
  redirect_uris: string[];
  scopes?: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateAppResponse {
  app_id: string;
  name: string;
  client_id: string;
  client_secret: string;
  public?: boolean;
  redirect_uris: string[];
  created_at: string;
  updated_at: string;
}
