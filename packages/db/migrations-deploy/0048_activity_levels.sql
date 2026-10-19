UPDATE `profile` SET `activity_level` = CASE `activity_level` WHEN 'low' THEN 'sedentary' WHEN 'mid' THEN 'light' WHEN 'high' THEN 'moderate' END WHERE `activity_level` IN ('low', 'mid', 'high');
