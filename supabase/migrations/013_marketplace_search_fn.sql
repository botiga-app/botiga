CREATE OR REPLACE FUNCTION marketplace_search(
  search_query  TEXT,
  price_min     NUMERIC DEFAULT NULL,
  price_max     NUMERIC DEFAULT NULL,
  result_limit  INT     DEFAULT 20,
  result_offset INT     DEFAULT 0
)
RETURNS SETOF marketplace_products
LANGUAGE sql STABLE
AS $$
  SELECT * FROM marketplace_products
  WHERE search_vector @@ plainto_tsquery('english', search_query)
    AND (price_min IS NULL OR price >= price_min)
    AND (price_max IS NULL OR price <= price_max)
  ORDER BY
    is_sponsored DESC,
    ts_rank(search_vector, plainto_tsquery('english', search_query)) DESC
  LIMIT result_limit
  OFFSET result_offset;
$$;
