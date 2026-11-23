-- DEVELOPMENT ONLY: sample promotional content. Loaded by `npm run db:seed`
-- only when SEED_DEV_DATA=true. Replace with real, compliant content.
INSERT INTO promotions (slug, title, summary, body, badge, terms, starts_at, ends_at) VALUES
 ('welcome-offer', 'Welcome Offer', 'Reduced commission on your first week of exchange betting.',
  'New customers pay reduced commission on net market winnings for 7 days after their first deposit.',
  'NEW', 'Sample terms. Replace before launch.', NOW(3), NULL),
 ('cricket-weekly', 'Cricket Weekly Boost', 'Featured cricket markets every weekend.',
  'Selected cricket markets carry boosted liquidity each weekend.',
  'CRICKET', 'Sample terms. Replace before launch.', NOW(3), NULL),
 ('acca-insurance', 'In-Play Insurance', 'Cash back as a free-bet token on qualifying in-play losses.',
  'Qualifying in-play losses are refunded as a token, subject to the terms.',
  'LIVE', 'Sample terms. Replace before launch.', NOW(3), NULL)
ON DUPLICATE KEY UPDATE title = VALUES(title);
