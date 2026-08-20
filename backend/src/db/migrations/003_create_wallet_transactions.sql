CREATE TABLE IF NOT EXISTS wallet_transactions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(120) NOT NULL CHECK (
        type IN ('DEPOSIT', 'TICKET', 'PRIZE', 'WITHDRAWAL', 'REFUND')
    ),
    amount BIGINT NOT NULL,
    reference VARCHAR(120) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'COMPLETED' CHECK (
        status IN ('PENDING', 'COMPLETED', 'FAILED')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_tx_type_reference
    ON wallet_transactions(type, reference);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user
    ON wallet_transactions(user_id);