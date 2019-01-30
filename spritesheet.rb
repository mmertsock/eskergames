# ruby spritesheet.rb [theme_directory]
# https://github.com/wvanbergen/chunky_png
# http://ruby-doc.com/docs/ProgrammingRuby/
# https://www.rubydoc.info/stdlib/core/Array

require 'chunky_png'
require 'yaml'

# TODO check argv for non-default value
themedir = '../Pixelmash/export/themes/default-map/'
yaml_destdir = './scratch/'
img_destdir = './spritesheets'

def fail(msg)
    puts msg
    exit
end

# a single raw input PNG file
# multiple files per sprite ID (one per tile width)
# may be multiple animated frames for one variant,
# or mulitple non-animated frames
class InputFile
    attr_reader :path, :is_animated, :img_filename, :tile_size_component, :tile_size, :theme_id, :pixel_size, :pixels_per_tile, :pixel_width, :pixel_height, :variant_key, :sprite_id, :img

    def initialize(path, is_animated)
        @path = path # full path string
        @is_animated = is_animated # bool
        (dirpath, fname) = File.split(path)
        @img_filename = fname # spriteid_variantkey_pixelsize.png
        # dirpath examples:
        # ../Pixelmash/export/themes/default-map/1x1/a/
        # ../Pixelmash/export/themes/tropical-island/3x3/
        dir_components = dirpath.split(File::SEPARATOR)
        if @is_animated
            @tile_size_component = dir_components[-2] # 1x1, etc.
            @theme_id = dir_components[-3] # default-map, etc.
        else
            @tile_size_component = dir_components[-1]
            @theme_id = dir_components[-2]
        end
        @tile_size = @tile_size_component.to_i
        fail("Invalid filename: " + @path) if @tile_size < 1

        name_parts = File.basename(@img_filename, '.png').split('_')
        @pixel_size = name_parts.pop.to_i
        fail("Invalid pixel size: " + @path) if @pixel_size < 1
        @pixels_per_tile = @pixel_size / @tile_size
        @variant_key = name_parts.last.to_i
        if @variant_key > 0 || name_parts.last == "0" || name_parts.last == "00"
            # explicit variant key found in filename, remove it from fname
            name_parts.pop
        end
        @sprite_id = name_parts.join("_")
        fail("Invalid filename: " + @path) if @sprite_id.empty?
    end

    def <=>(other_file)
        idcmp = @sprite_id <=> other_file.sprite_id
        idcmp = (@variant_key <=> other_file.variant_key) if idcmp == 0
        idcmp = (@pixel_size <=> other_file.pixel_size) if idcmp == 0
        idcmp
    end 

    def to_s
        "a? " + @is_animated.to_s + ", imgfn: " + @img_filename + ", tsc: " + @tile_size_component + ", px: " + @pixel_size.to_s + ", sid: " + @sprite_id + ", vk: " + @variant_key.to_s
    end

    def load_img!
        @img = ChunkyPNG::Image.from_file(@path)
        @pixel_width = @img.width
        @pixel_height = @img.height
        fail("Unexpected image height: " + @path) if @pixel_height != @pixel_size
        fail("Unexpected image width: " + @path) if @pixel_width % @pixel_size != 0
    end

    def unload_img!
        @img = nil
    end
end

# the primary transformer of all input files to output files
class Processor
    def initialize(files)
        @sheets = {}
        @sprite_groups = {}
        # sort to ensure sprite id/variant key ordering is identical in each Spritesheet
        files.sort().each { |file| add_input_file(file) }
    end

    def has_spritesheet_for?(file)
        @sheets.has_key?(Spritesheet.uid_for_input_file(file))
    end

    def all_sheets
        @sheets.values
    end

    def sheet_or_new_for(file)
        if !has_spritesheet_for? file
            sheet = Spritesheet.new(file)
            @sheets[Spritesheet.uid_for_input_file(file)] = sheet
        end
        @sheets[Spritesheet.uid_for_input_file(file)]
    end

    def add_input_file(file) # InputFile
        sheet = sheet_or_new_for(file)
        sheet.add_input_file(file)
    end

    def compose(img_destdir, yaml_destdir)
        theme_id = all_sheets.first.theme_id

        all_sheets.each do |sheet|
            fail("Failure composing sheet " + sheet.file_name) if !sheet.compose(img_destdir)
            sheet.collect_sprites(@sprite_groups)
        end
        size_counts = @sprite_groups.values.map { |group| group.num_sizes }.uniq()
        fail("Mismatched pixel size variations for some sprites: " + size_counts.join(", ")) if size_counts.size > 1

        yaml_theme = {}
        yaml_theme["id"] = theme_id
        yaml_theme["isDefault"] = true
        yaml_theme["sheets"] = all_sheets.map { |sheet| sheet.file_info }
        yaml_theme["sprites"] = @sprite_groups.values.map { |group| group.yaml_data }
        yaml_file_name = "sprites_" + theme_id + ".yaml"
        yaml_root = {"themes" => [yaml_theme]}
        IO.write(File.join(yaml_destdir, yaml_file_name), yaml_root.to_yaml)
        puts "Saved config " + yaml_file_name
    end
end

# Corresponds to exactly one output PNG file.
# Each instance is a sheet ID + tile width
class Spritesheet
    attr_reader :theme_id, :tile_size_component, :pixel_size, :pixel_width, :pixel_height, :file_name, :path, :files, :sprites

    def Spritesheet.uid_for_input_file(file)
        Spritesheet.file_name(file.theme_id, file.tile_size_component, file.pixel_size)
    end

    def Spritesheet.file_name(theme_id, tile_size_component, pixel_size)
        [theme_id, tile_size_component, pixel_size].join("_") + ".png"
    end

    def initialize(sample_file)
        @theme_id = sample_file.theme_id
        @tile_size_component = sample_file.tile_size_component
        @pixels_per_tile = sample_file.pixels_per_tile
        @tile_size = sample_file.tile_size
        @sheet_id = [@theme_id, @tile_size_component].join("_")
        @pixel_size = sample_file.pixel_size
        @file_name = Spritesheet.file_name(sample_file.theme_id, sample_file.tile_size_component, sample_file.pixel_size)
        @path = File.join("spritesheets", @file_name)
        @files = []
        @pixel_height = 0
        @pixel_width = 0
        @sprites = []
        @sprite_rows = []
    end

    def to_s
        "Spritesheet " + @file_name + ", filecount:" + @files.size.to_s
    end

    def file_info
        { "id" => @sheet_id, "path" => @path, "tileSize" => { "width" => @tile_size, "height" => @tile_size }, "tileWidth" => @pixels_per_tile, "imageSize" => { "width" => @pixel_width, "height" => @pixel_height } }
    end

    def add_input_file(file)
        @files.push(file)
    end

    def compose(destdir)
        row = 0
        @files.each do |file|
            file.load_img!
            make_sprites(file, row)
            row += 1
        end

        fail("Zero-width spritesheet: " + @path) if @pixel_width < 1
        fail("Zero-height spritesheet: " + @path) if @pixel_height < 1
        @img = ChunkyPNG::Image.new(@pixel_width, @pixel_height)

        @sprite_rows.each do |sprite|
            compose_sprite_row(sprite)
            sprite.unload_img!
        end

        @img.save(File.join(destdir, @file_name))
        @img = nil
        puts "Saved Spritesheet image " + @file_name
        true
    end

    def make_sprites(file, row)
        sprite_row = SpriteRow.new(file, row, @pixel_height)
        @sprite_rows.push(sprite_row)
        @sprites = @sprites + sprite_row.variants
        @pixel_height += sprite_row.pixel_height
        @pixel_width = [@pixel_width, sprite_row.pixel_width].max
    end

    def compose_sprite_row(sprite_row)
        @img.compose!(sprite_row.file.img, sprite_row.x, sprite_row.y)
    end

    def collect_sprites(sprite_groups)
        @sprites.each do |sprite|
            if sprite_groups.has_key?(sprite.file.sprite_id)
                group = sprite_groups[sprite.file.sprite_id]
            else
                group = SpriteGroup.new(sprite, @sheet_id)
                sprite_groups[sprite.file.sprite_id] = group
            end
            group.add_sprite(sprite)
        end
    end
end

class SpriteGroup
    attr_reader :sprites, :variants

    def initialize(sample_sprite, sheet_id)
        @sprite_id = sample_sprite.sprite_id
        @sheet_id = sheet_id
        @tile_size = sample_sprite.file.tile_size
        @sprites = []
        @variants = {}
    end

    def num_sizes
        if @variants.size < 1
            0
        else
            @variants.values.first.size
        end
    end

    def add_sprite(sprite)
        if @variants.has_key?(sprite.variant_key)
            @variants[sprite.variant_key].push(sprite)
        else
            @variants[sprite.variant_key] = [sprite]
        end
        @sprites.push(sprite)
    end

    def yaml_data
        obj = {}
        obj["id"] = @sprite_id
        obj["sheetID"] = @sheet_id
        obj["tileSize"] = { "width" => @tile_size, "height" => @tile_size }
        variants = []

        if @variants.values.map { |v| v.size }.uniq().size > 1
            fail("Sprite " + @sprite_id + " has missing files for some variants.")
        end

        @variants.values.each do |v|
            variant = {}
            urows = v.map { |item| item.row }.uniq()
            uframes = v.map { |item| item.frames }.uniq()
            fail("Sprite " + @sprite_id + " has mismatched row numbers for some variants: " + urows.join(", ")) if urows.size > 1
            fail("Sprite " + @sprite_id + " has mismatched frame counts for some variants: " + uframes.join(", ")) if uframes.size > 1
            variant["row"] = v.first.row
            variant["column"] = v.first.column
            variant["frames"] = v.first.frames
            variants.push(variant)
        end
        obj["variants"] = variants
        return obj
    end
end

class Sprite
    attr_reader :file, :sprite_id, :pixel_size, :pixel_height, :row, :column, :x, :y, :is_animated, :frames, :variant_key

    def initialize(sprite_row, column)
        @file = sprite_row.file
        @sprite_id = sprite_row.sprite_id
        @pixel_size = sprite_row.pixel_height
        @pixel_height = sprite_row.pixel_height
        @row = sprite_row.row
        @column = column
        @x = sprite_row.x + (column * @pixel_size)
        @y = sprite_row.y
        @is_animated = sprite_row.file.is_animated
        if @is_animated
            @frames = sprite_row.frames
            @variant_key = sprite_row.file.variant_key
        else
            @frames = 1
            @variant_key = column
        end

        # puts "Sprite #{file.img_filename} ID#{sprite_id} SZ#{pixel_size} PH#{pixel_height} R#{row} C#{column} X#{x} Y#{y} A#{is_animated} F#{frames} V#{variant_key}"
    end
end

class SpriteRow

    @@gutter_width = 0

    attr_reader :pixel_width, :content_width, :pixel_height, :file, :x, :y, :frames, :row, :group_id, :sprite_id

    def initialize(file, row, y)
        @file = file
        @pixel_width = @@gutter_width + file.pixel_width
        @content_width = file.pixel_width
        @pixel_height = file.pixel_height
        @row = row
        @x = @@gutter_width
        @y = y
        @frames = @content_width / @file.pixel_size
        @sprite_id = file.sprite_id
        if file.is_animated
            @group_id = file.sprite_id + "!a"
        else
            @group_id = file.sprite_id
        end
    end

    def variants
        if @file.is_animated
            [Sprite.new(self, 0)]
        else
            Array.new(@frames) { |column| Sprite.new(self, column) }
        end
    end

    def unload_img!
        @file.unload_img!
    end
end

Dir.exist?(themedir) or fail("Theme directory not found.")

if !Dir.exist?(img_destdir)
    Dir.mkdir(img_destdir)
    puts "Created directory " + img_destdir
end

static_input_files = Dir.glob(File.join(themedir, '[0-9]x[0-9]', '*.png'))
animated_input_files = Dir.glob(File.join(themedir, '[0-9]x[0-9]', 'a', '*.png'))
input_files = static_input_files.map { |path| InputFile.new(path, false) }
input_files = input_files + animated_input_files.map { |path| InputFile.new(path, true) }

if input_files.empty?
    fail("No input files.")
end

processor = Processor.new(input_files)
processor.compose(img_destdir, yaml_destdir)
