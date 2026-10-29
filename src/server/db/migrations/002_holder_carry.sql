ALTER TABLE projects ADD COLUMN holder_carry numeric(30,0) NOT NULL DEFAULT 0 CHECK(holder_carry>=0 AND holder_carry<=undistributed);
