#!/bin/bash

TOKEN=$1
GROUP_ID=$2
GITLAB_URL="git01.fecredit.com.vn"

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: bash script.sh <TOKEN> <GROUP_ID>"
    exit 1
fi

echo "Fetching Group Name for ID: $GROUP_ID"

GROUP_INFO=$(curl --silent --header "PRIVATE-TOKEN: $TOKEN" "https://$GITLAB_URL/api/v4/groups/$GROUP_ID")
TARGET_DIR=$(echo "$GROUP_INFO" | sed -E 's/.*"path":"([^"]+)".*/\1/')

if [ -z "$TARGET_DIR" ]; then
    echo "Error: Could not find Group with ID $GROUP_ID. Check your Token and Group ID."
    exit 1
fi

echo "Target Directory will be: ./$TARGET_DIR"

echo "Terminating background Git processes to unlock folders..."
taskkill //F //IM git.exe //T 2>/dev/null
taskkill //F //IM ssh-agent.exe //T 2>/dev/null

if [ -d "$TARGET_DIR" ]; then
    echo "Removing existing directory: $TARGET_DIR"
    
    find "$TARGET_DIR" -name ".git" -type d -exec chmod -R 777 {} + 2>/dev/null
    
    rm -rf "$TARGET_DIR"
    
    if [ $? -ne 0 ]; then
        echo "Error: Could not delete the folder. Please ensure no files are open in VS Code or CMD."
        exit 1
    else
        echo "Successfully cleaned up old repositories."
    fi
fi

echo "Creating directory '$TARGET_DIR' and fetching projects..."
mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"

page=1
while true; do
    echo "Fetching project list - Page $page..."
    
    response=$(curl --silent --header "PRIVATE-TOKEN: $TOKEN" \
    "https://$GITLAB_URL/api/v4/groups/$GROUP_ID/projects?include_subgroups=true&per_page=100&page=$page")

    urls=$(echo "$response" | grep -oP '"ssh_url_to_repo":"\K[^"]+')

    if [ -z "$urls" ]; then
        echo "Finished fetching all pages."
        break
    fi

    for url in $urls; do
        echo "Cloning: $url"
        git clone "$url"
    done

    ((page++))
done

echo "SUCCESS: All repositories have been cloned."