# Makefile: shortcuts for commands we run often.
# Run a target with `make <target>`, e.g. `make up`.
# Each target is a name followed by `:`, and the commands under it
# must be indented with a TAB (not spaces).

# Variables. `?=` sets a default you can override: `make up ENV_FILE=staging.env`.
ENV_FILE ?= .env
# Common prefix for every Compose command. --env-file makes Compose read
# the root .env instead of deploy/.env.
COMPOSE  := docker compose -f deploy/compose.yml --env-file $(ENV_FILE)

# These targets are commands, not files to build.
.PHONY: up down logs ps config

# Start the stack in the background.
up:
	$(COMPOSE) up -d

# Stop and remove the containers (named volumes are kept).
down:
	$(COMPOSE) down

# Follow the logs of all services.
logs:
	$(COMPOSE) logs -f

# List containers, including exited ones like shortener-migrate.
ps:
	$(COMPOSE) ps -a

# Print the compose file with every ${VAR} filled in (checks .env loads).
config:
	$(COMPOSE) config
