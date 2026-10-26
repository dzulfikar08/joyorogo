-- Plan-neutral wording (Strava API Policy 5.8): a released connection is one that went unused.
UPDATE `strava_release` SET `reason` = 'idle' WHERE `reason` = 'released_for_pro';
