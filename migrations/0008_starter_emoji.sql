UPDATE drawers SET emoji = CASE name
  WHEN 'Family' THEN '🏠'
  WHEN 'Birthdays' THEN '🎂'
  WHEN 'Anniversaries' THEN '💍'
  WHEN 'Work' THEN '💼'
  ELSE emoji
END WHERE emoji = '🎁' AND name IN ('Family', 'Birthdays', 'Anniversaries', 'Work');
