-- ADD VALUE must be its own migration (no same-transaction usage).
ALTER TYPE pipeline_stage ADD VALUE 'PREQUALIFICATION' BEFORE 'LEAD';
