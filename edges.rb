
require 'chunky_png'
require 'yaml'

srcdir = '../Pixelmash/export/edges'
key_destdir = './scratch/edges/'
sprite_destdir = '../Pixelmash/export/themes/default-map/1x1/a'
#sprite_destdir = './scratch/edges/sprites/'

def fail(msg)
    puts msg
    exit
end

Dir.exist?(srcdir) or fail("Source directory not found.")

if !Dir.exist?(key_destdir)
    Dir.mkdir(key_destdir)
    puts "Created directory " + key_destdir
end

base_files = Dir.glob(File.join(srcdir, '*-base_*.png'))

class SpriteRow
    attr_reader :imgs

    def initialize(pixel_size, img_array = nil, file_path = nil)
        @pixel_size = pixel_size
        if file_path == nil
            @imgs = img_array
        else
            row = ChunkyPNG::Image.from_file(file_path)
            fail("Unexpected image size #{row.width} x #{row.height} for #{file_path}") if row.height != @pixel_size
            fail("Unexpected image aspect ratio #{row.width} x #{row.height} for #{file_path}") if row.width % row.height != 0
            frames = row.width / row.height
            @imgs = Array.new(frames) { |i| row.crop(i * @pixel_size, 0, @pixel_size, @pixel_size) }
        end
    end

    def map(&block)
        SpriteRow.new(@pixel_size, @imgs.map(&block))
    end

    def frame_count
        @imgs.size
    end

    def frame(counter)
        @imgs[counter % @imgs.size]
    end

    def save(file_path)
        canvas = ChunkyPNG::Image.new(@pixel_size * @imgs.size, @pixel_size)
        @imgs.each_with_index do |img, index|
            canvas.compose!(img, index * @pixel_size, 0)
        end
        canvas.save(file_path)
    end
end

class EdgeGenerator
    def initialize(base_file_path)
        (dirpath, @base_file_name) = File.split(base_file_path)
        name_parts = File.basename(@base_file_name, '.png').split('_')

        @pixel_size = name_parts.pop.to_i
        fail("Invalid pixel size: " + base_file_path) if @pixel_size < 1
        @sprite_id = name_parts.first.chomp("-base")

        edge_source_map = {
            "terrain-ocean" => "terrain-water",
            "terrain-freshwater" => "terrain-water",
            "terrain-forest" => "terrain-forest"
        }
        @edge_source_id = edge_source_map[@sprite_id]

        # not supporting animation yet
        @base_img = SpriteRow.new(@pixel_size, nil, base_file_path)
        @deep_img = SpriteRow.new(@pixel_size, nil, File.join(dirpath, "#{@edge_source_id}-deep_#{@pixel_size}.png"))
        @edge_imgs = {}
        load_edge_rotations(dirpath, "N", ["straight-n", "straight-e", "straight-s", "straight-w"])
        load_edge_rotations(dirpath, "NE", ["angle-ne", "angle-se", "angle-sw", "angle-nw"])
        load_edge_rotations(dirpath, "NE-shallow", ["corner-ne", "corner-se", "corner-sw", "corner-nw"])

        @dirt_color = ChunkyPNG::Color.from_hsl(33, 0.33, 0.8)
        @mockup_ocean_color = ChunkyPNG::Color.from_hsl(200, 1.0, 0.15) #was 0.29 l
        @edge_gradient_rgb = [87, 249, 255] # seawater

        @mockup_canvas_name = "key-#{@sprite_id}_#{@pixel_size}.png"
        @mockup_sample_rows = 16
        @mockup_sample_cols = 16
        @mockup_stats = []
        @variant_map = [] # maps every 2-byte index value to a variant key
        @variants = [] # list of unique variants: index is variant key, value is edge config
        @variant_neighborhoods = []
    end

    def to_s
        "EdgeGenerator #{@sprite_id}_#{@pixel_size}"
    end

    def load_edge_rotations(dirpath, type, keys)
        path = File.join(dirpath, "#{@edge_source_id}-edge-#{type}_#{@pixel_size}.png")
        row = SpriteRow.new(@pixel_size, nil, path)
        @edge_imgs[keys[0]] = row
        @edge_imgs[keys[1]] = row.map { |img| img.rotate_right }
        @edge_imgs[keys[2]] = row.map { |img| img.rotate_180 }
        @edge_imgs[keys[3]] = row.map { |img| img.rotate_left }
    end

    def process(key_destdir, sprite_destdir)
        puts "Process #{to_s}"

        mockup_sample_width = @pixel_size * 3 * @mockup_sample_rows
        mockup_sample_height = @pixel_size * 3 * @mockup_sample_cols
        mockup_canvas = ChunkyPNG::Image.new(mockup_sample_width, mockup_sample_height)
        256.times { |index| make_mockup(mockup_canvas, index, 0) }
        mockup_canvas.save(File.join(key_destdir, @mockup_canvas_name))

        # puts "Variants:"
        # @variant_map.each_with_index do |mapped_key, variant_key|
        #     if mapped_key > 1000
        #         puts "#{variant_key}: #{@variants[mapped_key - 1000]} ****"
        #     else
        #         puts "#{variant_key} => #{@variants[mapped_key]}"
        #     end
        # end

        save_variants(sprite_destdir)
        save_yaml(key_destdir)
    end

    # each mockup is a 3x3 tile space, so you can mark up the neighbors
    def make_mockup(canvas, index, frame)
        (row, col) = index.divmod(@mockup_sample_cols)
        width = @pixel_size * 3
        height = @pixel_size * 3
        x = col * width
        y = row * height

        idlog = []
        neighbors = EdgeGrid.new(1 + col * 3, 1 + row * 3)
        neighbors.fill_int(index)
        neighbors.values.each_index do |i|
            if neighbors.is_edge_index_center?(i)
                compose_tile(canvas, neighbors, frame, x + @pixel_size, y + @pixel_size, idlog)
            else
                if neighbors.values[i]
                    color = @dirt_color #dirt
                else
                    color = @mockup_ocean_color
                end
                coord = neighbors.coord_for_edge_index(i)
                nx = coord.x * @pixel_size
                ny = coord.y * @pixel_size
                canvas.rect(nx, ny, nx + @pixel_size, ny + @pixel_size, color, color)
            end
        end
        # puts neighbors.to_s

        identity = idlog.join("|")

        existing_variant_key = @variants.index(identity)
        if existing_variant_key == nil
            @variants.push(identity)
            @variant_neighborhoods.push(neighbors)
            @variant_map[index] = 1000 + (@variants.size - 1)
            canvas.rect(x, y, x + width - 1, y + height - 1, ChunkyPNG::Color.rgb(255, 0, 0), ChunkyPNG::Color::TRANSPARENT)
        else
            @variant_map[index] = existing_variant_key
            canvas.rect(x, y, x + width - 1, y + height - 1, ChunkyPNG::Color::BLACK, ChunkyPNG::Color.rgba(0, 0, 0, 64))
        end
    end

    def compose_tile(canvas, neighbors, frame, x, y, idlog)
        canvas.compose!(@base_img.frame(frame), x, y)

        compose_depth_gradient(canvas, neighbors, frame, x, y)

        # add shallow diagonal edges (special case)
        compose_edge(canvas, idlog, "corner-ne", frame, x, y, neighbors.NE && !(neighbors.N || neighbors.E))
        compose_edge(canvas, idlog, "corner-se", frame, x, y, neighbors.SE && !(neighbors.E || neighbors.S))
        compose_edge(canvas, idlog, "corner-sw", frame, x, y, neighbors.SW && !(neighbors.S || neighbors.W))
        compose_edge(canvas, idlog, "corner-nw", frame, x, y, neighbors.NW && !(neighbors.N || neighbors.W))

        # add straight-line edges
        compose_edge(canvas, idlog, "straight-n", frame, x, y, neighbors.N)
        compose_edge(canvas, idlog, "straight-e", frame, x, y, neighbors.E)
        compose_edge(canvas, idlog, "straight-s", frame, x, y, neighbors.S)
        compose_edge(canvas, idlog, "straight-w", frame, x, y, neighbors.W)

        # add deep diagonal edges
        compose_edge(canvas, idlog, "angle-ne", frame, x, y, neighbors.N && neighbors.E)
        compose_edge(canvas, idlog, "angle-se", frame, x, y, neighbors.E && neighbors.S)
        compose_edge(canvas, idlog, "angle-sw", frame, x, y, neighbors.S && neighbors.W)
        compose_edge(canvas, idlog, "angle-nw", frame, x, y, neighbors.N && neighbors.W)
    end

    def compose_edge(canvas, idlog, img_key, frame, x, y, condition)
        if condition
            canvas.compose!(@edge_imgs[img_key].frame(frame), x, y)
            if idlog
                idlog.push(img_key)
            end
        end
    end

    def score(*bools)
        bools.count { |item| item }
    end

    def compose_depth_gradient(canvas, neighbors, frame, x, y)
        if @pixel_size < 5
            return
        end
        corner_scores = {
            "ne" => score(neighbors.N, neighbors.NE, neighbors.E),
            "se" => score(neighbors.E, neighbors.SE, neighbors.S),
            "sw" => score(neighbors.S, neighbors.SW, neighbors.W),
            "nw" => score(neighbors.W, neighbors.NW, neighbors.N)
        }
        deep_img = @deep_img.frame(frame)
        (0...@pixel_size).each do |dy|
            yfraction = (dy * 1.0 / (@pixel_size - 1))
            l = scale_value(yfraction, corner_scores["nw"], corner_scores["sw"])
            r = scale_value(yfraction, corner_scores["ne"], corner_scores["se"])
            (0...@pixel_size).each do |dx|
                xfraction = (dx * 1.0 / (@pixel_size - 1))
                edginess = scale_value(xfraction, l, r)
                # if @variants.size == 5 && neighbors.W
                #     puts "#{dx}, #{dy}: edginess=#{edginess}, color=#{ChunkyPNG::Color.a(color)}"
                # end
                color = deep_img_alpha(edginess, deep_img, dx, dy)
                canvas[dx + x, dy + y] = canvas.compose_pixel(dx + x, dy + y, color)
                if l + r > 0
                    color = edginess_gradient_color(edginess)
                    canvas[dx + x, dy + y] = canvas.compose_pixel(dx + x, dy + y, color)
                end
            end
        end
    end

    def scale_value(fraction, min, max)
        min + fraction * (max - min)
    end

    def edginess_gradient_color(edginess)
        max_edginess = 3.0
        max_alpha = 0.5
        ChunkyPNG::Color.rgba(@edge_gradient_rgb[0], @edge_gradient_rgb[1], @edge_gradient_rgb[2], (255 * (max_alpha * edginess / max_edginess)).to_i)
    end

    def deep_img_alpha(edginess, img, dx, dy)
        max_edginess = 3.0
        depth = (max_edginess - edginess) / max_edginess # 0...1 range
        ChunkyPNG::Color.fade(img[dx, dy], (255.0 * depth * depth * depth).to_i)
    end

    def save_variants(destdir)
        @variants.each_with_index do |edge_list, variant_key|
            file_name = "#{@sprite_id}_#{variant_key}_#{@pixel_size}.png"
            # puts "Save file #{file_name} with edges #{edge_list}"
            frame_index = 0
            row = @base_img.map do |base_frame|
                img = ChunkyPNG::Image.new(@pixel_size, @pixel_size)
                img.replace!(base_frame, 0, 0)
                compose_depth_gradient(img, @variant_neighborhoods[variant_key], frame_index, 0, 0)
                edge_list.split("|").each do |img_key|
                    img.compose!(@edge_imgs[img_key].frame(frame_index), 0, 0)
                end
                frame_index = frame_index + 1
                img
            end
            row.save(File.join(destdir, file_name))
        end
        puts "Generated #{@variants.size} variants for spritesheet.rb processing."
    end

    def save_yaml(destdir)
        path = File.join(destdir, "edge-config.yaml")
        variant_yaml = []
        @variant_map.each_with_index do |mapped_key, variant_key|
            variant_yaml[variant_key] = mapped_key % 1000
        end
        raw_yaml = "edgeVariants: [#{variant_yaml.join(", ")}]"
        # :indentation => 3
        IO.write(path, raw_yaml)
    end
end

class EdgeGrid
    attr_reader :values

    def initialize(x, y)
        @origin_x = x
        @origin_y = y
        # 0 1 2
        # 3 4 5
        # 6 7 8
        @values = Array.new(9) { |i| 0 }
    end

    def to_s
        "<EdgeGrid #{@values.join(" ")}>"
    end

    def NW
        @values[0]
    end
    def N
        @values[1]
    end
    def NE
        @values[2]
    end
    def W
        @values[3]
    end
    def E
        @values[5]
    end
    def SW
        @values[6]
    end
    def S
        @values[7]
    end
    def SE
        @values[8]
    end

    def is_edge_index_center?(i)
        i == 4
    end

    def coord_for_edge_index(i)
        (row, col) = i.divmod(3)
        ChunkyPNG::Point.new(@origin_x + col - 1, @origin_y + row - 1)
    end

    def value_index_for_edge(dx, dy)
        ((dy + 1) * 3) + (dx + 1)
    end

    def get_edge(dx, dy)
        @values[value_index_for_edge(dx, dy)]
    end

    def set_edge(dx, dy, value)
        @values[value_index_for_edge(dx, dy)] = value
    end

    def fill_int(value)
        set_edge(-1, -1, (value & 1) > 0)
        set_edge( 0, -1, (value & 2) > 0)
        set_edge( 1, -1, (value & 4) > 0)
        set_edge(-1,  0, (value & 8) > 0)
        set_edge( 1,  0, (value & 16) > 0)
        set_edge(-1,  1, (value & 32) > 0)
        set_edge( 0,  1, (value & 64) > 0)
        set_edge( 1,  1, (value & 128) > 0)
    end
end

base_files.each do |file|
    EdgeGenerator.new(file).process(key_destdir, sprite_destdir)
end
