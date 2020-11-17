big_endian
requires 0 "01 00"
section "Header" {
    uint8 "Version"
    uint8 "Sharing Mode"
    uint8 "Difficulty"
    set width [uint8]
    set height [uint8]
    entry "Width" $width
    entry "Height" $height
    uint16 "Mine Count"
    uint8 "Checksum"
}

proc TileLabel {row col} {
    return "[expr ($row)], [expr ($col)]"
}

proc FirstBit {row col width height dead_bit_count} {
    set tile_index [expr (($row * $width) + $col)]
    set last_byte_first_index [expr ($width * $height) - (8 - $dead_bit_count)]

    if {$tile_index > $last_byte_first_index} {
        return -1
    }
    if {$tile_index == $last_byte_first_index} {
        if {$dead_bit_count > 0} {
            entry "(Skip bits)" $dead_bit_count
        }
        return [expr (7 - $dead_bit_count)]
    }
    return 7
}

section "Tile Array" {
    set dead_bit_count [uint8]
    entry "Dead Bit Count" $dead_bit_count
    set row 0
    set col 0
    set bit [FirstBit $row $col $width $height $dead_bit_count]

    section "Row [expr ($row)]"
    while {![end]} {
        if {$col == $width} {
            set col 0
            set row [expr ($row + 1)]
            endsection
            section "Row [expr ($row)]"
        }

        set coord "[TileLabel $row $col]"
        uint8_bits "[expr ($bit)]" $coord

        set col [expr ($col + 1)]
        if {$bit == 0} {
            set bit [FirstBit $row $col $width $height $dead_bit_count]
        } else {
            set bit [expr ($bit - 1)]
            move -1
        }
    }
    endsection
}
