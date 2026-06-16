-- Pipeline gains SUBMITTED (post-proposal-sent) and NO_GO (killed before bidding).
-- Project gains AWARDED (won, pre-mobilization-complete, not yet ACTIVE).
ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'NO_GO';
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'AWARDED' AFTER 'TENDER';
