filter_01=$(cat ./cli-test/filters/filter-01.txt)

# This is the default.
# NODE_ENV=development

bun run --watch src/cli.ts \
    --resource-names "[\"projects/$LILO_GCP_PROJECT\"]" \
    --filter "$filter_01" \
    --db ./del/db.sqlite \
    --watch 2000
