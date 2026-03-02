-- Seed sponsorship_taxonomies. Non-endemic set is standardized across all sports.
-- sort_order: endemic 0..n, non_endemic 1000..n so endemic appears first.

-- Helper: insert non-endemic for one sport (same list for all)
-- Standardized NON_ENDEMIC + Unknown for import fallback
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Surf', 'NON_ENDEMIC', 'Alcohol', 1000),
  ('Surf', 'NON_ENDEMIC', 'Cannabis / CBD', 1001),
  ('Surf', 'NON_ENDEMIC', 'Grooming / Skincare', 1002),
  ('Surf', 'NON_ENDEMIC', 'Automotive', 1003),
  ('Surf', 'NON_ENDEMIC', 'Tech Hardware', 1004),
  ('Surf', 'NON_ENDEMIC', 'Financial Services / Fintech', 1005),
  ('Surf', 'NON_ENDEMIC', 'Telecommunications', 1006),
  ('Surf', 'NON_ENDEMIC', 'Health & Wellness', 1007),
  ('Surf', 'NON_ENDEMIC', 'Audio & Headphones', 1008),
  ('Surf', 'NON_ENDEMIC', 'Unknown', 1009)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Surf ENDEMIC
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Surf', 'ENDEMIC', 'Wetsuits', 0),
  ('Surf', 'ENDEMIC', 'Surf Accessories (fins, leashes, traction, wax)', 1),
  ('Surf', 'ENDEMIC', 'Surf Hardware (board bags, travel cases)', 2),
  ('Surf', 'ENDEMIC', 'Surf Retail (surf shops / surf e-comm)', 3),
  ('Surf', 'ENDEMIC', 'Apparel', 4),
  ('Surf', 'ENDEMIC', 'Footwear', 5),
  ('Surf', 'ENDEMIC', 'Sunglasses / Eyewear', 6),
  ('Surf', 'ENDEMIC', 'Sunscreen / SPF', 7),
  ('Surf', 'ENDEMIC', 'Watches (tide / water-resistant)', 8),
  ('Surf', 'ENDEMIC', 'Energy Drinks', 9),
  ('Surf', 'ENDEMIC', 'Hydration', 10),
  ('Surf', 'ENDEMIC', 'Protein / Supplements', 11)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Skateboard: non-endemic first
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'Skateboard', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Skateboard', 'ENDEMIC', 'Deck Brands', 0),
  ('Skateboard', 'ENDEMIC', 'Trucks', 1),
  ('Skateboard', 'ENDEMIC', 'Wheels', 2),
  ('Skateboard', 'ENDEMIC', 'Bearings', 3),
  ('Skateboard', 'ENDEMIC', 'Grip Tape', 4),
  ('Skateboard', 'ENDEMIC', 'Hardware (bolts, risers)', 5),
  ('Skateboard', 'ENDEMIC', 'Protective Gear (helmets, pads)', 6),
  ('Skateboard', 'ENDEMIC', 'Skate Shoes', 7),
  ('Skateboard', 'ENDEMIC', 'Skate Tools & Accessories', 8),
  ('Skateboard', 'ENDEMIC', 'Apparel', 9),
  ('Skateboard', 'ENDEMIC', 'Sunglasses / Eyewear', 10),
  ('Skateboard', 'ENDEMIC', 'Watches', 11),
  ('Skateboard', 'ENDEMIC', 'Backpacks / Bags', 12),
  ('Skateboard', 'ENDEMIC', 'Energy Drinks', 13),
  ('Skateboard', 'ENDEMIC', 'Hydration', 14),
  ('Skateboard', 'ENDEMIC', 'Protein / Supplements', 15)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- BMX
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'BMX', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('BMX', 'ENDEMIC', 'Frames', 0),
  ('BMX', 'ENDEMIC', 'Forks', 1),
  ('BMX', 'ENDEMIC', 'Handlebars', 2),
  ('BMX', 'ENDEMIC', 'Wheels', 3),
  ('BMX', 'ENDEMIC', 'Tires', 4),
  ('BMX', 'ENDEMIC', 'Cranks', 5),
  ('BMX', 'ENDEMIC', 'Pedals', 6),
  ('BMX', 'ENDEMIC', 'Chains & Drivetrain Components', 7),
  ('BMX', 'ENDEMIC', 'Brakes', 8),
  ('BMX', 'ENDEMIC', 'Sprockets', 9),
  ('BMX', 'ENDEMIC', 'Seats & Seatposts', 10),
  ('BMX', 'ENDEMIC', 'Grips', 11),
  ('BMX', 'ENDEMIC', 'Complete BMX Bikes', 12),
  ('BMX', 'ENDEMIC', 'Helmets', 13),
  ('BMX', 'ENDEMIC', 'Protective Gear (pads, guards)', 14),
  ('BMX', 'ENDEMIC', 'Apparel', 15),
  ('BMX', 'ENDEMIC', 'Footwear', 16),
  ('BMX', 'ENDEMIC', 'Sunglasses / Eyewear', 17),
  ('BMX', 'ENDEMIC', 'Watches', 18),
  ('BMX', 'ENDEMIC', 'Backpacks / Gear Bags', 19),
  ('BMX', 'ENDEMIC', 'Energy Drinks', 20),
  ('BMX', 'ENDEMIC', 'Hydration', 21),
  ('BMX', 'ENDEMIC', 'Protein / Supplements', 22)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Supercross / Motocross (Moto)
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'Supercross / Motocross (Moto)', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Motorcycle Manufacturers (OEMs)', 0),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Complete Motorcycles (privateer builds / race teams)', 1),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Exhaust Systems', 2),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Suspension (forks, shocks)', 3),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Wheels & Rims', 4),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Tires', 5),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Brakes', 6),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Engine Performance Parts', 7),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Clutches & Drivetrain', 8),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Handlebars & Controls', 9),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Foot Pegs', 10),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Radiators & Cooling Systems', 11),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Electronics / ECU / Mapping', 12),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Aftermarket Plastics & Body Kits', 13),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Helmets', 14),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Goggles', 15),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Boots', 16),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Protective Armor (chest, knee, neck braces)', 17),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Gloves', 18),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Apparel', 19),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Sunglasses / Eyewear', 20),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Watches', 21),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Gear Bags', 22),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Tools / Garage Equipment', 23),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Energy Drinks', 24),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Hydration', 25),
  ('Supercross / Motocross (Moto)', 'ENDEMIC', 'Protein / Supplements', 26)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Mountain Bike
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'Mountain Bike', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Mountain Bike', 'ENDEMIC', 'Bicycle Manufacturers (OEMs)', 0),
  ('Mountain Bike', 'ENDEMIC', 'Complete Mountain Bikes', 1),
  ('Mountain Bike', 'ENDEMIC', 'Suspension (forks, rear shocks)', 2),
  ('Mountain Bike', 'ENDEMIC', 'Wheels', 3),
  ('Mountain Bike', 'ENDEMIC', 'Tires', 4),
  ('Mountain Bike', 'ENDEMIC', 'Drivetrain (SRAM/Shimano components)', 5),
  ('Mountain Bike', 'ENDEMIC', 'Brakes', 6),
  ('Mountain Bike', 'ENDEMIC', 'Handlebars', 7),
  ('Mountain Bike', 'ENDEMIC', 'Stems', 8),
  ('Mountain Bike', 'ENDEMIC', 'Seatposts (incl. dropper posts)', 9),
  ('Mountain Bike', 'ENDEMIC', 'Pedals', 10),
  ('Mountain Bike', 'ENDEMIC', 'Cranks', 11),
  ('Mountain Bike', 'ENDEMIC', 'Frames (aftermarket)', 12),
  ('Mountain Bike', 'ENDEMIC', 'Helmets', 13),
  ('Mountain Bike', 'ENDEMIC', 'Protective Armor (pads, guards)', 14),
  ('Mountain Bike', 'ENDEMIC', 'Gloves', 15),
  ('Mountain Bike', 'ENDEMIC', 'Apparel', 16),
  ('Mountain Bike', 'ENDEMIC', 'Footwear', 17),
  ('Mountain Bike', 'ENDEMIC', 'Sunglasses / Eyewear', 18),
  ('Mountain Bike', 'ENDEMIC', 'Watches / GPS Devices', 19),
  ('Mountain Bike', 'ENDEMIC', 'Bike Packs / Hydration Packs', 20),
  ('Mountain Bike', 'ENDEMIC', 'Energy Drinks', 21),
  ('Mountain Bike', 'ENDEMIC', 'Hydration', 22),
  ('Mountain Bike', 'ENDEMIC', 'Protein / Supplements', 23)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Snowboard
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'Snowboard', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Snowboard', 'ENDEMIC', 'Snowboard Manufacturers', 0),
  ('Snowboard', 'ENDEMIC', 'Bindings', 1),
  ('Snowboard', 'ENDEMIC', 'Boots', 2),
  ('Snowboard', 'ENDEMIC', 'Goggles', 3),
  ('Snowboard', 'ENDEMIC', 'Outerwear (jackets, snow pants)', 4),
  ('Snowboard', 'ENDEMIC', 'Helmets', 5),
  ('Snowboard', 'ENDEMIC', 'Gloves / Mittens', 6),
  ('Snowboard', 'ENDEMIC', 'Board Accessories (wax, tuning kits, stomp pads)', 7),
  ('Snowboard', 'ENDEMIC', 'Avalanche Safety Equipment', 8),
  ('Snowboard', 'ENDEMIC', 'Backcountry Packs', 9),
  ('Snowboard', 'ENDEMIC', 'Heated Gear', 10),
  ('Snowboard', 'ENDEMIC', 'Apparel', 11),
  ('Snowboard', 'ENDEMIC', 'Footwear (lifestyle)', 12),
  ('Snowboard', 'ENDEMIC', 'Sunglasses / Eyewear', 13),
  ('Snowboard', 'ENDEMIC', 'Watches', 14),
  ('Snowboard', 'ENDEMIC', 'Backpacks / Travel Bags', 15),
  ('Snowboard', 'ENDEMIC', 'Energy Drinks', 16),
  ('Snowboard', 'ENDEMIC', 'Hydration', 17),
  ('Snowboard', 'ENDEMIC', 'Protein / Supplements', 18)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Ski
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'Ski', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Ski', 'ENDEMIC', 'Ski Manufacturers', 0),
  ('Ski', 'ENDEMIC', 'Ski Boots', 1),
  ('Ski', 'ENDEMIC', 'Bindings', 2),
  ('Ski', 'ENDEMIC', 'Ski Poles', 3),
  ('Ski', 'ENDEMIC', 'Goggles', 4),
  ('Ski', 'ENDEMIC', 'Helmets', 5),
  ('Ski', 'ENDEMIC', 'Outerwear (jackets, snow pants)', 6),
  ('Ski', 'ENDEMIC', 'Gloves / Mittens', 7),
  ('Ski', 'ENDEMIC', 'Ski Accessories (wax, tuning kits, straps)', 8),
  ('Ski', 'ENDEMIC', 'Avalanche Safety Equipment', 9),
  ('Ski', 'ENDEMIC', 'Backcountry Packs', 10),
  ('Ski', 'ENDEMIC', 'Heated Gear', 11),
  ('Ski', 'ENDEMIC', 'Ski Protection Gear (spine guards, race suits)', 12),
  ('Ski', 'ENDEMIC', 'Apparel', 13),
  ('Ski', 'ENDEMIC', 'Footwear (lifestyle)', 14),
  ('Ski', 'ENDEMIC', 'Sunglasses / Eyewear', 15),
  ('Ski', 'ENDEMIC', 'Watches', 16),
  ('Ski', 'ENDEMIC', 'Backpacks / Travel Bags', 17),
  ('Ski', 'ENDEMIC', 'Energy Drinks', 18),
  ('Ski', 'ENDEMIC', 'Hydration', 19),
  ('Ski', 'ENDEMIC', 'Protein / Supplements', 20)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Racing / Motorsports
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'Racing / Motorsports', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Racing / Motorsports', 'ENDEMIC', 'Automotive OEMs', 0),
  ('Racing / Motorsports', 'ENDEMIC', 'Performance Vehicle Brands', 1),
  ('Racing / Motorsports', 'ENDEMIC', 'Electric Vehicle Manufacturers', 2),
  ('Racing / Motorsports', 'ENDEMIC', 'Engine Performance Parts', 3),
  ('Racing / Motorsports', 'ENDEMIC', 'Exhaust Systems', 4),
  ('Racing / Motorsports', 'ENDEMIC', 'Suspension Systems', 5),
  ('Racing / Motorsports', 'ENDEMIC', 'Tires', 6),
  ('Racing / Motorsports', 'ENDEMIC', 'Wheels / Rims', 7),
  ('Racing / Motorsports', 'ENDEMIC', 'Braking Systems', 8),
  ('Racing / Motorsports', 'ENDEMIC', 'Fuel Systems', 9),
  ('Racing / Motorsports', 'ENDEMIC', 'Transmission / Drivetrain Components', 10),
  ('Racing / Motorsports', 'ENDEMIC', 'Performance Electronics / ECU', 11),
  ('Racing / Motorsports', 'ENDEMIC', 'Aerodynamics & Body Kits', 12),
  ('Racing / Motorsports', 'ENDEMIC', 'Aftermarket Parts Manufacturers', 13),
  ('Racing / Motorsports', 'ENDEMIC', 'Fuel Brands (Racing & Performance Fuels)', 14),
  ('Racing / Motorsports', 'ENDEMIC', 'Helmets', 15),
  ('Racing / Motorsports', 'ENDEMIC', 'Racing Suits', 16),
  ('Racing / Motorsports', 'ENDEMIC', 'Gloves', 17),
  ('Racing / Motorsports', 'ENDEMIC', 'Safety Equipment (HANS devices, fire systems)', 18),
  ('Racing / Motorsports', 'ENDEMIC', 'Footwear (racing boots)', 19),
  ('Racing / Motorsports', 'ENDEMIC', 'Tools / Garage Equipment', 20),
  ('Racing / Motorsports', 'ENDEMIC', 'Automotive Fluids (oil, lubricants, coolants)', 21),
  ('Racing / Motorsports', 'ENDEMIC', 'Trailer / Hauling Equipment', 22),
  ('Racing / Motorsports', 'ENDEMIC', 'Apparel', 23),
  ('Racing / Motorsports', 'ENDEMIC', 'Sunglasses / Eyewear', 24),
  ('Racing / Motorsports', 'ENDEMIC', 'Watches', 25),
  ('Racing / Motorsports', 'ENDEMIC', 'Gear Bags', 26),
  ('Racing / Motorsports', 'ENDEMIC', 'Energy Drinks', 27),
  ('Racing / Motorsports', 'ENDEMIC', 'Hydration', 28),
  ('Racing / Motorsports', 'ENDEMIC', 'Protein / Supplements', 29)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Track & Field
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'Track & Field', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Track & Field', 'ENDEMIC', 'Footwear (Track Spikes / Performance Running Shoes)', 0),
  ('Track & Field', 'ENDEMIC', 'Training Footwear', 1),
  ('Track & Field', 'ENDEMIC', 'Timing Equipment', 2),
  ('Track & Field', 'ENDEMIC', 'Wearable Performance Tech (GPS watches, heart rate monitors)', 3),
  ('Track & Field', 'ENDEMIC', 'Recovery Equipment (compression boots, foam rollers)', 4),
  ('Track & Field', 'ENDEMIC', 'Apparel', 5),
  ('Track & Field', 'ENDEMIC', 'Sunglasses / Eyewear', 6),
  ('Track & Field', 'ENDEMIC', 'Watches', 7),
  ('Track & Field', 'ENDEMIC', 'Backpacks / Gear Bags', 8),
  ('Track & Field', 'ENDEMIC', 'Energy Drinks', 9),
  ('Track & Field', 'ENDEMIC', 'Hydration', 10),
  ('Track & Field', 'ENDEMIC', 'Protein / Supplements', 11),
  ('Track & Field', 'ENDEMIC', 'Performance Nutrition (gels, carb fuel, electrolytes)', 12),
  ('Track & Field', 'ENDEMIC', 'Physical Therapy Tools', 13),
  ('Track & Field', 'ENDEMIC', 'Bracing / Support Gear', 14),
  ('Track & Field', 'ENDEMIC', 'Sports Tape & Recovery Products', 15)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Swimming
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'Swimming', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Swimming', 'ENDEMIC', 'Swimwear (competition suits & training suits)', 0),
  ('Swimming', 'ENDEMIC', 'Goggles', 1),
  ('Swimming', 'ENDEMIC', 'Swim Caps', 2),
  ('Swimming', 'ENDEMIC', 'Training Equipment (kickboards, pull buoys, paddles)', 3),
  ('Swimming', 'ENDEMIC', 'Fins', 4),
  ('Swimming', 'ENDEMIC', 'Snorkels (training)', 5),
  ('Swimming', 'ENDEMIC', 'Swim Bags', 6),
  ('Swimming', 'ENDEMIC', 'Waterproof Wearables (GPS watches, lap trackers)', 7),
  ('Swimming', 'ENDEMIC', 'Timing Equipment', 8),
  ('Swimming', 'ENDEMIC', 'Underwater Audio Devices', 9),
  ('Swimming', 'ENDEMIC', 'Apparel', 10),
  ('Swimming', 'ENDEMIC', 'Footwear (slides, recovery sandals)', 11),
  ('Swimming', 'ENDEMIC', 'Sunglasses / Eyewear', 12),
  ('Swimming', 'ENDEMIC', 'Watches', 13),
  ('Swimming', 'ENDEMIC', 'Recovery Equipment', 14),
  ('Swimming', 'ENDEMIC', 'Bracing / Support Gear', 15),
  ('Swimming', 'ENDEMIC', 'Physical Therapy Tools', 16),
  ('Swimming', 'ENDEMIC', 'Energy Drinks', 17),
  ('Swimming', 'ENDEMIC', 'Hydration', 18),
  ('Swimming', 'ENDEMIC', 'Protein / Supplements', 19),
  ('Swimming', 'ENDEMIC', 'Performance Fuel (gels, electrolyte systems)', 20)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Rowing
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'Rowing', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Rowing', 'ENDEMIC', 'Boat Manufacturers (Shells)', 0),
  ('Rowing', 'ENDEMIC', 'Oars', 1),
  ('Rowing', 'ENDEMIC', 'Rowing Shoes (boat-mounted)', 2),
  ('Rowing', 'ENDEMIC', 'Seats & Sliding Systems', 3),
  ('Rowing', 'ENDEMIC', 'Rigging Components', 4),
  ('Rowing', 'ENDEMIC', 'Coxing Equipment', 5),
  ('Rowing', 'ENDEMIC', 'Rowing Machines (Ergs)', 6),
  ('Rowing', 'ENDEMIC', 'Indoor Training Systems', 7),
  ('Rowing', 'ENDEMIC', 'Performance Monitors', 8),
  ('Rowing', 'ENDEMIC', 'Apparel', 9),
  ('Rowing', 'ENDEMIC', 'Footwear (training)', 10),
  ('Rowing', 'ENDEMIC', 'Sunglasses / Eyewear', 11),
  ('Rowing', 'ENDEMIC', 'Watches / GPS Wearables', 12),
  ('Rowing', 'ENDEMIC', 'Gear Bags', 13),
  ('Rowing', 'ENDEMIC', 'Recovery Equipment', 14),
  ('Rowing', 'ENDEMIC', 'Physical Therapy Tools', 15),
  ('Rowing', 'ENDEMIC', 'Bracing / Support Gear', 16),
  ('Rowing', 'ENDEMIC', 'Energy Drinks', 17),
  ('Rowing', 'ENDEMIC', 'Hydration', 18),
  ('Rowing', 'ENDEMIC', 'Protein / Supplements', 19),
  ('Rowing', 'ENDEMIC', 'Performance Fuel (gels, carb systems)', 20)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Kayak
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'Kayak', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Kayak', 'ENDEMIC', 'Kayak Manufacturers', 0),
  ('Kayak', 'ENDEMIC', 'Paddles', 1),
  ('Kayak', 'ENDEMIC', 'Spray Skirts', 2),
  ('Kayak', 'ENDEMIC', 'Personal Flotation Devices (PFDs)', 3),
  ('Kayak', 'ENDEMIC', 'Helmets', 4),
  ('Kayak', 'ENDEMIC', 'Dry Suits', 5),
  ('Kayak', 'ENDEMIC', 'Wet Suits', 6),
  ('Kayak', 'ENDEMIC', 'Gloves', 7),
  ('Kayak', 'ENDEMIC', 'Whitewater Safety Equipment', 8),
  ('Kayak', 'ENDEMIC', 'Throw Bags / Rescue Gear', 9),
  ('Kayak', 'ENDEMIC', 'Flotation / Buoyancy Systems', 10),
  ('Kayak', 'ENDEMIC', 'Indoor Kayak Trainers', 11),
  ('Kayak', 'ENDEMIC', 'Paddle Training Equipment', 12),
  ('Kayak', 'ENDEMIC', 'Performance Wearables (GPS, waterproof devices)', 13),
  ('Kayak', 'ENDEMIC', 'Apparel', 14),
  ('Kayak', 'ENDEMIC', 'Footwear (water shoes, recovery footwear)', 15),
  ('Kayak', 'ENDEMIC', 'Sunglasses / Eyewear', 16),
  ('Kayak', 'ENDEMIC', 'Watches', 17),
  ('Kayak', 'ENDEMIC', 'Gear Bags', 18),
  ('Kayak', 'ENDEMIC', 'Energy Drinks', 19),
  ('Kayak', 'ENDEMIC', 'Hydration', 20),
  ('Kayak', 'ENDEMIC', 'Protein / Supplements', 21),
  ('Kayak', 'ENDEMIC', 'Performance Fuel (gels, electrolytes)', 22)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Outdoor / Climbing
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'Outdoor / Climbing', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Outdoor / Climbing', 'ENDEMIC', 'Rope Manufacturers', 0),
  ('Outdoor / Climbing', 'ENDEMIC', 'Harnesses', 1),
  ('Outdoor / Climbing', 'ENDEMIC', 'Carabiners', 2),
  ('Outdoor / Climbing', 'ENDEMIC', 'Belay Devices', 3),
  ('Outdoor / Climbing', 'ENDEMIC', 'Quickdraws', 4),
  ('Outdoor / Climbing', 'ENDEMIC', 'Protection (cams, nuts, trad gear)', 5),
  ('Outdoor / Climbing', 'ENDEMIC', 'Crash Pads', 6),
  ('Outdoor / Climbing', 'ENDEMIC', 'Chalk & Chalk Bags', 7),
  ('Outdoor / Climbing', 'ENDEMIC', 'Climbing Shoes', 8),
  ('Outdoor / Climbing', 'ENDEMIC', 'Helmets', 9),
  ('Outdoor / Climbing', 'ENDEMIC', 'Ice Axes', 10),
  ('Outdoor / Climbing', 'ENDEMIC', 'Crampons', 11),
  ('Outdoor / Climbing', 'ENDEMIC', 'Avalanche Safety Equipment', 12),
  ('Outdoor / Climbing', 'ENDEMIC', 'Technical Packs', 13),
  ('Outdoor / Climbing', 'ENDEMIC', 'Climbing Hardware Systems', 14),
  ('Outdoor / Climbing', 'ENDEMIC', 'Rescue Equipment', 15),
  ('Outdoor / Climbing', 'ENDEMIC', 'Headlamps / Technical Lighting', 16),
  ('Outdoor / Climbing', 'ENDEMIC', 'Apparel', 17),
  ('Outdoor / Climbing', 'ENDEMIC', 'Footwear (approach / lifestyle)', 18),
  ('Outdoor / Climbing', 'ENDEMIC', 'Sunglasses / Eyewear', 19),
  ('Outdoor / Climbing', 'ENDEMIC', 'Watches / GPS Devices', 20),
  ('Outdoor / Climbing', 'ENDEMIC', 'Backpacks / Travel Packs', 21),
  ('Outdoor / Climbing', 'ENDEMIC', 'Energy Drinks', 22),
  ('Outdoor / Climbing', 'ENDEMIC', 'Hydration', 23),
  ('Outdoor / Climbing', 'ENDEMIC', 'Protein / Supplements', 24),
  ('Outdoor / Climbing', 'ENDEMIC', 'Performance Fuel (gels, electrolytes)', 25)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- Lifestyle / Broadcast / Chef / Personality
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT 'Lifestyle / Broadcast / Chef / Personality', 'NON_ENDEMIC', category, sort_order FROM public.sponsorship_taxonomies WHERE sport = 'Surf' AND tier = 'NON_ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order) VALUES
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Media Production Equipment (cameras, lighting, mics)', 0),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Content Creation Software / Platforms', 1),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Streaming Platforms', 2),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Podcast Equipment', 3),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Publishing Platforms', 4),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Apparel', 5),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Footwear', 6),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Watches', 7),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Sunglasses / Eyewear', 8),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Jewelry / Accessories', 9),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Kitchen Appliances', 10),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Cookware', 11),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Knives', 12),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Food & Beverage Brands', 13),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Grocery / Ingredient Brands', 14),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Restaurant / Hospitality Groups', 15),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Fitness Brands', 16),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Supplements', 17),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Energy Drinks', 18),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Hydration', 19),
  ('Lifestyle / Broadcast / Chef / Personality', 'ENDEMIC', 'Health & Wellness Products', 20)
ON CONFLICT (sport, tier, category) DO NOTHING;
