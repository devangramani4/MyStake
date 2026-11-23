-- Reference data that is safe in every environment (no fake betting data).
-- Betfair event type IDs are the official Betfair identifiers.
INSERT INTO sports (betfair_id, name, slug, icon, display_order) VALUES
  ('4',       'Cricket',      'cricket',      'cricket',     1),
  ('1',       'Football',     'football',     'football',    2),
  ('2',       'Tennis',       'tennis',       'tennis',      3),
  ('7522',    'Basketball',   'basketball',   'basketball',  4),
  ('7511',    'Baseball',     'baseball',     'baseball',    5),
  ('7524',    'Ice Hockey',   'ice-hockey',   'hockey',      6),
  ('998917',  'Volleyball',   'volleyball',   'volleyball',  7),
  ('5',       'Rugby Union',  'rugby',        'rugby',       8),
  ('3',       'Golf',         'golf',         'golf',        9),
  ('6',       'Boxing',       'boxing',       'boxing',     10),
  ('26420387','Mixed Martial Arts','mma',     'mma',        11),
  ('7',       'Horse Racing', 'horse-racing', 'horse',      12),
  ('27454571','Esports',      'esports',      'esports',    13)
ON DUPLICATE KEY UPDATE name = VALUES(name), display_order = VALUES(display_order);

INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('risk.defaults', JSON_OBJECT('minStake', 10, 'maxStake', 100000, 'maxExposure', 500000, 'maxOdds', 1000, 'maxMarketLiability', 1000000)),
  ('risk.alerts',   JSON_OBJECT('largeStakeMultiplier', 10, 'rapidBetsPerMinute', 20, 'failedBetsPerHour', 15)),
  ('commission',    JSON_OBJECT('rate', 0.02)),
  ('compliance',    JSON_OBJECT('requireKycForWithdrawal', true, 'limitIncreaseCooldownHours', 24))
ON DUPLICATE KEY UPDATE setting_key = setting_key;
