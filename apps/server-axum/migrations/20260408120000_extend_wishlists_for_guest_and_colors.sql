ALTER TABLE wishlists
    ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT 'sand';

DO $$
BEGIN
    ALTER TABLE wishlists
        ADD CONSTRAINT wishlists_color_check
        CHECK (color IN ('sand', 'amber', 'rose', 'plum', 'sky', 'teal', 'sage', 'slate'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
