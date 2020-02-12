#!/bin/bash
declare -a PACKAGES
DPA_FILE_PATH="/opt/eurotech/esf/data/dpa.properties"

install_packages () {
    rm $DPA_FILE_PATH 2> /dev/null
    touch $DPA_FILE_PATH
    mkdir /opt/eurotech/esf/data/packages 2> /dev/null
    for package in "${PACKAGES[@]}"; do
        package_name=`echo $package | sed  's/_.*//'`
        cp /tmp/$package /opt/eurotech/esf/data/packages/$package
        echo "$package_name=file\:/opt/eurotech/esf/data/packages/$package" >> $DPA_FILE_PATH
    done
}

while [[ $# -gt 0 ]]
do
    PACKAGES=("$2" "${PACKAGES[@]}")
    shift
    shift
done

install_packages
