#!/bin/bash
filename=".ssh/id_rsa"

if [ -f "$filename" ]
then
    echo "$filename" already exists
else
    mkdir -p .ssh
    ssh-keygen -t rsa -b 2048 -N "" -m PEM -f .ssh/id_rsa
    echo "created $filename"
fi
