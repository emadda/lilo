NODE_ENV=development;

filter_01=$(cat ./cli-test/filters/filter-01.txt)
bun run --watch src/cli.ts \
    --resource-names "[\"projects/$LILO_GCP_PROJECT\"]" \
    --filter "$filter_01" \
    --db ./del/db.sqlite \
    --watch 2000
