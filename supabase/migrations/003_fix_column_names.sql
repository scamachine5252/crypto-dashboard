ALTER TABLE accounts RENAME COLUMN label TO account_name;
ALTER TABLE accounts RENAME COLUMN api_key_encrypted TO api_key;
ALTER TABLE accounts RENAME COLUMN api_secret_encrypted TO api_secret;
ALTER TABLE accounts RENAME COLUMN passphrase_encrypted TO passphrase;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fund text NOT NULL DEFAULT '';
