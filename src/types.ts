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
  version?: string;
  // Review-submission form for public apps (BEX-221); absent for private apps.
  google_form_link?: string;
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
  version?: string;
  created_at: string;
  updated_at: string;
}

// Wire shape for POST /v3/app-store/apps/{app_id}/upload — deliberately
// distinct from OAuthApp: distribution_type nests under auth (OAuthApp keeps
// it top-level), the version field is named app_version (not version), and
// redirect URLs are redirect_urls (not redirect_uris like every other
// endpoint). These are confirmed, intentional quirks of this one endpoint —
// do not "fix" them to match OAuthApp's naming.
export interface UploadAppPayload {
  app_id: string;
  name: string;
  logo_uri: string;
  app_version: string;
  auth: {
    distribution_type: 'public' | 'private';
    scopes: string[];
    redirect_urls: string[];
  };
}

export interface UploadAppResponse {
  app_id: string;
  name: string;
  logo_uri?: string;
  app_version?: string;
  auth: {
    distribution_type?: 'public' | 'private';
    scopes?: string[];
    redirect_urls?: string[];
  };
}
