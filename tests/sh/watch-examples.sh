# Commands to watch the stdout/stderr of multiple lilo CLI's whilst testing.

viddy "exa --color=always --long --tree --level 2 --time-style long-iso --no-permissions --no-user 01/del"
viddy "cat ./01/del/**/*stdout.txt"
viddy "cat ./01/del/**/*stderr.txt"


# Get min and max for test and single run.
#
#attach '/x/watch-default.sqlite' as orig;
#select
#	(select min(receiveTimestamp) from logs) min_recv,
#	(select max(receiveTimestamp) from logs) max_recv,
#	(select min(timestamp) from logs) min_ts,
#	(select max(timestamp) from logs) max_ts,
#	(select min(receiveTimestamp) from orig.logs) orig_min_recv,
#	(select max(receiveTimestamp) from orig.logs) orig_max_recv,
#	(select min(timestamp) from logs) orig_min_ts,
#	(select max(timestamp) from logs) orig_max_ts








