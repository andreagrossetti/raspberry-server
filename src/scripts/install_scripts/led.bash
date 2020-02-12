#!/bin/bash

turn_leds_on () {
    # Turn amber leds on
    echo 0 > /sys/class/leds/led1-green/brightness
    echo 0 > /sys/class/leds/led2-green/brightness
    echo 1 > /sys/class/leds/led1-amber/brightness
    echo 1 > /sys/class/leds/led2-amber/brightness
}

turn_leds_off () {
    # Turn amber leds on
    echo 0 > /sys/class/leds/led1-amber/brightness
    echo 0 > /sys/class/leds/led2-amber/brightness
}

if [ $1 = "on" ]; then
  turn_leds_on
else
  turn_leds_off
fi
